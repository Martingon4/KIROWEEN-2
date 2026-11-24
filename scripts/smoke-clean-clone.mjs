import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const source = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), "fork-the-city-smoke-"));
const copy = join(temporaryRoot, "project");
const excluded = new Set([
  ".git",
  ".next",
  "node_modules",
  ".env.local",
  "playwright-report",
  "test-results",
]);

try {
  cpSync(source, copy, {
    recursive: true,
    filter(path) {
      if (path === source) return true;
      const relative = path.slice(source.length + 1);
      return !relative.split("/").some((segment) => excluded.has(segment));
    },
  });

  for (const [command, args] of [
    ["npm", ["ci"]],
    ["npm", ["run", "check"]],
  ]) {
    const result = spawnSync(command, args, { cwd: copy, stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
      );
    }
  }

  console.log(`Clean-copy smoke passed for ${basename(resolve(source))}.`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
