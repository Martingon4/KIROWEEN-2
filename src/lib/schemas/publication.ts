import { z } from "zod";
import { interventionListSchema } from "@/lib/schemas/intervention";

export const MAX_PUBLICATION_LABEL_LENGTH = 100;
export const MAX_PUBLICATION_SUMMARY_LENGTH = 1000;

export const publishRevisionRequestSchema = z.object({
  label: z.string().trim().min(1).max(MAX_PUBLICATION_LABEL_LENGTH),
  summary: z.string().trim().min(1).max(MAX_PUBLICATION_SUMMARY_LENGTH),
});

export const publishRevisionResponseSchema = z.object({
  data: z.object({
    publicationId: z.uuid(),
    revisionId: z.uuid(),
    branchId: z.uuid(),
    publishedAt: z.string(),
  }),
});

/** Public projection: no branch, parent, revision message, account id, or email. */
export const publicPublicationSchema = z.strictObject({
  publicationId: z.uuid(),
  label: z.string(),
  summary: z.string(),
  authorAlias: z.string(),
  publishedAt: z.string(),
  siteId: z.uuid(),
  baselineId: z.uuid(),
  scenario: z.literal("hypothetical"),
  features: interventionListSchema,
});

export type PublicPublication = z.infer<typeof publicPublicationSchema>;

/** Rows from the owner-only `publications` select, mapped to the editor's shape. */
export const ownerPublicationsSchema = z.array(
  z
    .object({
      id: z.uuid(),
      revision_id: z.uuid(),
      public_label: z.string(),
      published_at: z.string(),
      moderation_state: z.enum(["visible", "hidden"]),
    })
    .transform((row) => ({
      id: row.id,
      revisionId: row.revision_id,
      label: row.public_label,
      publishedAt: row.published_at,
      hidden: row.moderation_state === "hidden",
    })),
);
