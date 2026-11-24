import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultIntervention } from "@/features/editor/defaults";
import {
  clearDraft,
  clearUserDrafts,
  draftKey,
  readDraft,
  writeDraft,
  type Draft,
} from "@/features/editor/draft";

const user = "11111111-1111-4111-8111-111111111111";
const otherUser = "22222222-2222-4222-8222-222222222222";
const site = "33333333-3333-4333-8333-333333333333";
const branch = "44444444-4444-4444-8444-444444444444";

function makeDraft(): Draft {
  return {
    baseRevisionId: "55555555-5555-4555-8555-555555555555",
    savedAt: "2026-05-14T10:00:00.000Z",
    features: [
      createDefaultIntervention(
        "shade_tree",
        "66666666-6666-4666-8666-666666666666",
        [-98.197, 19.0436],
        { label: "Árbol", timeSlot: "Sábados" },
      ),
    ],
  };
}

describe("draft", () => {
  beforeEach(() => window.localStorage.clear());

  it("escribe y lee un borrador", () => {
    const key = draftKey(user, site, branch);
    const draft = makeDraft();
    writeDraft(window.localStorage, key, draft);
    expect(readDraft(window.localStorage, key)).toEqual(draft);
  });

  it("devuelve null si no hay borrador", () => {
    expect(
      readDraft(window.localStorage, draftKey(user, site, branch)),
    ).toBeNull();
  });

  it.each([
    ["JSON inválido", "{not json"],
    ["forma incorrecta", JSON.stringify({ features: "x" })],
  ])("elimina un borrador corrupto (%s) y devuelve null", (_name, raw) => {
    const key = draftKey(user, site, branch);
    window.localStorage.setItem(key, raw);
    expect(readDraft(window.localStorage, key)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("clearDraft elimina el borrador", () => {
    const key = draftKey(user, site, branch);
    writeDraft(window.localStorage, key, makeDraft());
    clearDraft(window.localStorage, key);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("clearUserDrafts borra solo las claves de ese usuario", () => {
    const mine1 = draftKey(user, site, branch);
    const mine2 = draftKey(user, site, "77777777-7777-4777-8777-777777777777");
    const theirs = draftKey(otherUser, site, branch);
    for (const key of [mine1, mine2, theirs]) {
      writeDraft(window.localStorage, key, makeDraft());
    }
    window.localStorage.setItem("unrelated", "keep");

    expect(clearUserDrafts(window.localStorage, user)).toBe(2);
    expect(window.localStorage.getItem(mine1)).toBeNull();
    expect(window.localStorage.getItem(mine2)).toBeNull();
    expect(window.localStorage.getItem(theirs)).not.toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });

  it("clearUserDrafts devuelve 0 si no hay borradores", () => {
    expect(clearUserDrafts(window.localStorage, user)).toBe(0);
  });
});
