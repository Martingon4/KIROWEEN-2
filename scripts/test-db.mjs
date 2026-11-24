import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const supabase = resolve("node_modules/.bin/supabase");
const result = spawnSync(supabase, ["status", "--output", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  console.error(
    "Database tests require the local Supabase stack. Run `npx supabase start` first.",
  );
  if (result.stderr.trim()) console.error(result.stderr.trim());
  process.exit(1);
}

const tests = spawnSync(supabase, ["test", "db"], {
  stdio: "inherit",
});
process.exit(tests.status ?? 1);
