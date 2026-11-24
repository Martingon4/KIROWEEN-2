import { z } from "zod";

const branchTitleSchema = z.string().trim().min(1).max(100);

/**
 * A branch starts from the site's active baseline or from a visible publication.
 * Strict objects make a body with both sources, or with unknown keys, invalid.
 */
export const createBranchRequestSchema = z.union([
  z.strictObject({ siteId: z.uuid(), title: branchTitleSchema }),
  z.strictObject({ sourcePublicationId: z.uuid(), title: branchTitleSchema }),
]);

export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

export const createBranchResponseSchema = z.object({
  data: z.object({
    branchId: z.uuid(),
    revisionId: z.uuid(),
    siteId: z.uuid(),
    title: z.string().min(1).max(100),
    baselineId: z.uuid().optional(),
    baselineIsActive: z.boolean().optional(),
    sourcePublicationId: z.uuid().optional(),
    featureCount: z.number().int().nonnegative().optional(),
  }),
});

/** Server-computed request fingerprint; the site variant keeps its original shape. */
export function branchPayloadFingerprint(input: CreateBranchRequest) {
  return "sourcePublicationId" in input
    ? { sourcePublicationId: input.sourcePublicationId, title: input.title }
    : { siteId: input.siteId, title: input.title };
}
