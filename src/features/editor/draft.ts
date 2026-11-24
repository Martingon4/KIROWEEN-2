import { z } from "zod";
import { interventionListSchema } from "@/lib/schemas/intervention";

/**
 * Local draft recovery, scoped by account, site, and branch. The storage
 * interface is injected so the logic stays testable without a browser.
 */
export type DraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

const DRAFT_PREFIX = "ftc:draft:v1";

const draftSchema = z.object({
  baseRevisionId: z.uuid(),
  savedAt: z.iso.datetime(),
  features: interventionListSchema,
});

export type Draft = z.infer<typeof draftSchema>;

export function draftKey(userId: string, siteId: string, branchId: string) {
  return `${DRAFT_PREFIX}:${userId}:${siteId}:${branchId}`;
}

export function readDraft(storage: DraftStorage, key: string): Draft | null {
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through: a corrupt draft is removed rather than trusted.
  }
  storage.removeItem(key);
  return null;
}

export function writeDraft(storage: DraftStorage, key: string, draft: Draft) {
  storage.setItem(key, JSON.stringify(draftSchema.parse(draft)));
}

export function clearDraft(storage: DraftStorage, key: string) {
  storage.removeItem(key);
}

/** Removes every draft that belongs to one account, for sign-out. */
export function clearUserDrafts(storage: DraftStorage, userId: string): number {
  const prefix = `${DRAFT_PREFIX}:${userId}:`;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}
