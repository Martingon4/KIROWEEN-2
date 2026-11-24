import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/lib/auth/return-path";

describe("safeReturnPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeReturnPath("/es/propuestas?from=place#draft", "es")).toBe(
      "/es/propuestas?from=place#draft",
    );
  });

  it.each([
    "https://attacker.example",
    "//attacker.example",
    "javascript:alert(1)",
    null,
  ])("rejects an unsafe return target: %s", (target) => {
    expect(safeReturnPath(target, "en")).toBe("/en");
  });
});
