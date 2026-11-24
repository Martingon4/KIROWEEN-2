import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const target = resolve(".env.local");
if (existsSync(target)) {
  // Existing credentials are never rewritten; only keys added by later specs are appended.
  const current = readFileSync(target, "utf8");
  const missing = [];
  if (!/^FTC_MODERATOR_EMAIL=/m.test(current)) {
    missing.push("FTC_MODERATOR_EMAIL=moderator@example.test");
  }
  if (!/^FTC_MODERATOR_PASSWORD=/m.test(current)) {
    missing.push(`FTC_MODERATOR_PASSWORD=${`${randomBytes(18).toString("base64url")}aA1!`}`);
  }
  if (missing.length > 0) {
    appendFileSync(target, `${current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
    chmodSync(target, 0o600);
    console.log("Kept existing .env.local and appended the moderator test account keys.");
  } else {
    console.log(
      "Keeping existing .env.local. Remove it explicitly to regenerate local credentials.",
    );
  }
  process.exit(0);
}

const output = execFileSync(
  resolve("node_modules/.bin/supabase"),
  ["status", "--output", "env"],
  { encoding: "utf8", env: { ...process.env, DO_NOT_TRACK: "1" } },
);

const local = Object.fromEntries(
  output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return [
        line.slice(0, separator),
        line.slice(separator + 1).replace(/^"|"$/g, ""),
      ];
    }),
);

if (!local.API_URL || !local.PUBLISHABLE_KEY) {
  console.error(
    "Start the local Supabase stack before configuring the app environment.",
  );
  process.exit(1);
}

const password = () => `${randomBytes(18).toString("base64url")}aA1!`;
const contents = [
  `NEXT_PUBLIC_SUPABASE_URL=${local.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${local.PUBLISHABLE_KEY}`,
  "NEXT_PUBLIC_APP_URL=http://localhost:3000",
  "NEXT_PUBLIC_MAP_STYLE_URL=",
  "APP_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://127.0.0.1:3100",
  "FTC_PARTICIPANT_EMAIL=participant@example.test",
  `FTC_PARTICIPANT_PASSWORD=${password()}`,
  "FTC_COORDINATOR_EMAIL=coordinator@example.test",
  `FTC_COORDINATOR_PASSWORD=${password()}`,
  "FTC_MODERATOR_EMAIL=moderator@example.test",
  `FTC_MODERATOR_PASSWORD=${password()}`,
  "",
].join("\n");

writeFileSync(target, contents, { mode: 0o600 });
chmodSync(target, 0o600);
console.log(
  "Wrote .env.local with local-only generated credentials (mode 0600).",
);
