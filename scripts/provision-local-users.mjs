import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const required = [
  "FTC_PARTICIPANT_EMAIL",
  "FTC_PARTICIPANT_PASSWORD",
  "FTC_COORDINATOR_EMAIL",
  "FTC_COORDINATOR_PASSWORD",
  "FTC_MODERATOR_EMAIL",
  "FTC_MODERATOR_PASSWORD",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing private environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const output = execFileSync(
  resolve("node_modules/.bin/supabase"),
  ["status", "--output", "env"],
  {
    encoding: "utf8",
    env: { ...process.env, DO_NOT_TRACK: "1" },
  },
);

const local = Object.fromEntries(
  output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      const name = line.slice(0, separator);
      const value = line.slice(separator + 1).replace(/^"|"$/g, "");
      return [name, value];
    }),
);

if (!local.API_URL || !local.SECRET_KEY) {
  console.error(
    "Local Supabase is not running or did not expose the expected local credentials.",
  );
  process.exit(1);
}

const supabase = createClient(local.API_URL, local.SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureUser(email, password) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!error) return data.user;
  if (!error.message.toLowerCase().includes("already")) throw error;

  const { data: users, error: listError } =
    await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = users.users.find((user) => user.email === email);
  if (!existing) throw error;
  return existing;
}

const participant = await ensureUser(
  process.env.FTC_PARTICIPANT_EMAIL,
  process.env.FTC_PARTICIPANT_PASSWORD,
);
const coordinator = await ensureUser(
  process.env.FTC_COORDINATOR_EMAIL,
  process.env.FTC_COORDINATOR_PASSWORD,
);

const { error: roleError } = await supabase.rpc("assign_site_role", {
  target_site_id: "8f5a6417-5f6d-4f02-a50c-76d97167db99",
  target_user_id: coordinator.id,
  target_role: "coordinator",
});
if (roleError) throw roleError;

const moderator = await ensureUser(
  process.env.FTC_MODERATOR_EMAIL,
  process.env.FTC_MODERATOR_PASSWORD,
);
const { error: moderatorRoleError } = await supabase.rpc("assign_site_role", {
  target_site_id: "8f5a6417-5f6d-4f02-a50c-76d97167db99",
  target_user_id: moderator.id,
  target_role: "moderator",
});
if (moderatorRoleError) throw moderatorRoleError;

console.log(
  `Provisioned ${new Set([participant.id, coordinator.id, moderator.id]).size} confirmed local test users.`,
);
