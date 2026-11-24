#!/usr/bin/env node
/**
 * Measures GET /api/v1/compare latency (plan §6.2 target: p95 <= 1.5 s over at least
 * 30 representative requests, cold start reported separately).
 *
 * Local only. Creates a labelled perf fixture in the local Supabase database: one
 * publication with 200 shade trees and a fork of it where half the trees change
 * height, so the comparison returns 100 modified features over 200 per side.
 *
 * Usage (server already running):  BASE_URL=http://127.0.0.1:3100 node scripts/perf-compare.mjs
 */
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import process from "node:process";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_KIROWEEN-2";
const MEASURED = Number(process.env.PERF_REQUESTS ?? 40);
const WARMUP = 5;

const fixtureSql = `
create temp table perf_ctx (k text primary key, v uuid);
grant all on table perf_ctx to authenticated;
insert into perf_ctx select 'actor', id from auth.users where email like 'participant%' order by email limit 1;
set role authenticated;
select set_config('request.jwt.claim.sub', (select v::text from perf_ctx where k = 'actor'), false);
insert into perf_ctx select 'branch', (r ->> 'branchId')::uuid
from (select public.create_branch('8f5a6417-5f6d-4f02-a50c-76d97167db99',
  'Perf fixture 200 trees', 'perf-' || gen_random_uuid(), repeat('a', 64)) r) s;
insert into perf_ctx select 'rev', (r ->> 'revisionId')::uuid
from (select public.save_revision(
  (select v from perf_ctx where k = 'branch'),
  (select (public.get_branch_head((select v from perf_ctx where k = 'branch')) ->> 'revisionId')::uuid),
  'Perf fixture: 200 trees',
  (select jsonb_agg(jsonb_build_object(
     'id', gen_random_uuid(),
     'kind', 'shade_tree',
     'properties', jsonb_build_object('label', 'Perf tree ' || (i * 10 + j), 'canopyDiameterM', 4, 'heightM', 6),
     'geometry', jsonb_build_object('type', 'Point', 'coordinates',
        jsonb_build_array(round((-98.19825 + i * 0.000001)::numeric, 6), round((19.04358 + j * 0.0000014)::numeric, 6)))))
   from generate_series(0, 19) as i, generate_series(0, 9) as j),
  'perf-save-' || gen_random_uuid(), repeat('b', 64)) r) s;
insert into perf_ctx select 'pubA', (r ->> 'publicationId')::uuid
from (select public.publish_revision((select v from perf_ctx where k = 'rev'),
  'Perf fixture A', 'Performance fixture, not a proposal.', 'perf-pub-' || gen_random_uuid(), repeat('c', 64)) r) s;
insert into perf_ctx select 'fork', (r ->> 'branchId')::uuid
from (select public.fork_publication((select v from perf_ctx where k = 'pubA'),
  'Perf fixture B', 'perf-fork-' || gen_random_uuid(), repeat('d', 64)) r) s;
insert into perf_ctx select 'revB', (r ->> 'revisionId')::uuid
from (select public.save_revision(
  (select v from perf_ctx where k = 'fork'),
  (select (public.get_branch_head((select v from perf_ctx where k = 'fork')) ->> 'revisionId')::uuid),
  'Perf fixture: half the trees taller',
  (select jsonb_agg(case when n % 2 = 0
                    then jsonb_set(f, '{properties,heightM}', '9'::jsonb) else f end)
   from (select f, row_number() over (order by f ->> 'id') as n
         from jsonb_array_elements(
           public.get_branch_head((select v from perf_ctx where k = 'fork')) -> 'features') as f) x),
  'perf-save-b-' || gen_random_uuid(), repeat('e', 64)) r) s;
insert into perf_ctx select 'pubB', (r ->> 'publicationId')::uuid
from (select public.publish_revision((select v from perf_ctx where k = 'revB'),
  'Perf fixture B', 'Performance fixture, not a proposal.', 'perf-pub-b-' || gen_random_uuid(), repeat('f', 64)) r) s;
select (select v from perf_ctx where k = 'pubA') || ' ' || (select v from perf_ctx where k = 'pubB');
`;

function createFixture() {
  const output = execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: fixtureSql, encoding: "utf8" },
  );
  const line = output.trim().split("\n").at(-1) ?? "";
  const [left, right] = line.split(" ");
  if (!left || !right) throw new Error(`fixture failed: ${output}`);
  return { left: `publication:${left}`, right: `publication:${right}` };
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function timedFetch(url) {
  const started = performance.now();
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.text();
  return { ms: performance.now() - started, status: response.status, bytes: body.length, body };
}

const { left, right } = createFixture();
const url = `${BASE_URL}/api/v1/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`;

const cold = await timedFetch(url);
if (cold.status !== 200) throw new Error(`compare returned ${cold.status}: ${cold.body.slice(0, 200)}`);
const counts = JSON.parse(cold.body).data.counts;
for (let i = 0; i < WARMUP; i += 1) await timedFetch(url);

const samples = [];
for (let i = 0; i < MEASURED; i += 1) {
  const sample = await timedFetch(url);
  if (sample.status !== 200) throw new Error(`request ${i} returned ${sample.status}`);
  samples.push(sample.ms);
}
samples.sort((a, b) => a - b);

const result = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  baseUrl: BASE_URL,
  fixture: { featuresPerSide: 200, counts },
  coldStartMs: Math.round(cold.ms),
  requests: MEASURED,
  warmup: WARMUP,
  p50Ms: Math.round(percentile(samples, 50)),
  p95Ms: Math.round(percentile(samples, 95)),
  maxMs: Math.round(samples.at(-1)),
  payloadBytes: cold.bytes,
  targetP95Ms: 1500,
};
result.meetsTarget = result.p95Ms <= result.targetP95Ms;
console.log(JSON.stringify(result, null, 2));
