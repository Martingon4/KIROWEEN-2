import { describe, expect, it } from "vitest";
import { isAllowedMutationOrigin } from "@/lib/auth/origin";

const allowed = ["http://localhost:3000", "https://preview.example"];

describe("isAllowedMutationOrigin", () => {
  it("accepts exact configured origins", () => {
    expect(isAllowedMutationOrigin("http://localhost:3000", allowed)).toBe(
      true,
    );
    expect(
      isAllowedMutationOrigin("https://preview.example/path", allowed),
    ).toBe(true);
  });

  it.each([
    null,
    "https://attacker.example",
    "not-a-url",
    "http://preview.example",
  ])("rejects an untrusted origin: %s", (origin) =>
    expect(isAllowedMutationOrigin(origin, allowed)).toBe(false),
  );
});
