import { z } from "zod";

export const MAX_COMMENT_LENGTH = 1000;
export const MAX_REPORT_NOTE_LENGTH = 500;
export const MAX_MODERATION_REASON_LENGTH = 500;

// Same rule as public.plain_text_ok: no C0/C1 controls except newline, no bidi overrides.
const FORBIDDEN_TEXT =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

/** Plain text: CRLF becomes LF, edges are trimmed, controls are rejected, never HTML. */
export const plainText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => !FORBIDDEN_TEXT.test(value)),
    );

export const createCommentRequestSchema = z.strictObject({
  body: plainText(1, MAX_COMMENT_LENGTH),
  featureId: z.uuid().nullable().optional(),
});

export const reportReasons = [
  "spam",
  "harassment",
  "misinformation",
  "privacy",
  "other",
] as const;

export const createReportRequestSchema = z.strictObject({
  targetKind: z.enum(["publication", "comment"]),
  targetId: z.uuid(),
  reason: z.enum(reportReasons),
  note: plainText(1, MAX_REPORT_NOTE_LENGTH).nullable().optional(),
});

export const moderationActionRequestSchema = z.strictObject({
  targetKind: z.enum(["publication", "comment"]),
  targetId: z.uuid(),
  action: z.enum(["hide", "restore"]),
  reason: plainText(1, MAX_MODERATION_REASON_LENGTH),
  privateNote: plainText(1, MAX_MODERATION_REASON_LENGTH).nullable().optional(),
  reportId: z.uuid().nullable().optional(),
});

export const resolveReportRequestSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("dismissed"),
    note: plainText(1, MAX_MODERATION_REASON_LENGTH),
  }),
  z.strictObject({
    outcome: z.literal("actioned"),
    eventId: z.uuid(),
  }),
]);

/**
 * Keyset cursor for comment and report lists. The timestamp is kept as the exact text
 * the database produced, so microseconds survive the round trip.
 */
const CURSOR_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-fA-F-]{36})$/;

export function encodeCursor(cursor: {
  createdAt: string;
  id: string;
}): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(
  value: string | null,
): { createdAt: string; id: string } | null | "invalid" {
  if (value === null || value === "") return null;
  if (value.length > 120) return "invalid";
  const text = Buffer.from(value, "base64url").toString("utf8");
  const match = CURSOR_PATTERN.exec(text);
  if (!match || !z.uuid().safeParse(match[2]).success) return "invalid";
  return { createdAt: match[1], id: match[2] };
}

const dbCursorSchema = z
  .object({ createdAt: z.string(), id: z.string() })
  .nullable();

export const publicCommentSchema = z.object({
  commentId: z.uuid(),
  body: z.string(),
  authorAlias: z.string(),
  createdAt: z.string(),
  /** True only for the caller's own comments; never identifies anyone else. */
  mine: z.boolean(),
  anchor: z
    .object({ featureId: z.uuid(), label: z.string().nullable() })
    .nullable(),
});

export const commentPageSchema = z.object({
  items: z.array(publicCommentSchema),
  nextCursor: dbCursorSchema,
});

export const communitySummarySchema = z.object({
  supportCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
});

export const createCommentResponseSchema = z.object({
  commentId: z.uuid(),
  publicationId: z.uuid(),
  featureId: z.uuid().nullable(),
  createdAt: z.string(),
});

export const supportResultSchema = z.object({
  supported: z.boolean(),
  count: z.number().int().nonnegative(),
});

export const createReportResponseSchema = z.object({
  reportId: z.uuid(),
  state: z.enum(["open", "actioned", "dismissed"]),
  duplicate: z.boolean(),
});

export const moderationNoticesSchema = z.object({
  items: z.array(
    z.object({
      commentId: z.uuid(),
      body: z.string(),
      state: z.enum(["hidden", "retracted"]),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const openReportSchema = z.object({
  reportId: z.uuid(),
  targetKind: z.enum(["publication", "comment"]),
  publicationId: z.uuid(),
  commentId: z.uuid().nullable(),
  reason: z.enum(reportReasons),
  note: z.string().nullable(),
  reporterAlias: z.string(),
  targetState: z.enum(["visible", "hidden"]),
  preview: z.string().nullable(),
  createdAt: z.string(),
});

export const openReportsPageSchema = z.object({
  items: z.array(openReportSchema),
  nextCursor: dbCursorSchema,
});

export const moderationTargetSchema = z.object({
  targetKind: z.enum(["publication", "comment"]),
  targetId: z.uuid(),
  siteId: z.uuid(),
  publicationId: z.uuid(),
  state: z.enum(["visible", "hidden"]),
  retracted: z.boolean().optional(),
  label: z.string().optional(),
  summary: z.string().optional(),
  body: z.string().optional(),
  authorAlias: z.string(),
  createdAt: z.string(),
  openReports: z.number().int().nonnegative(),
  history: z.array(
    z.object({
      eventId: z.uuid(),
      action: z.enum(["hide", "restore", "dismiss"]),
      reason: z.string(),
      privateNote: z.string().nullable(),
      actorAlias: z.string(),
      createdAt: z.string(),
    }),
  ),
});

export const moderationActionResultSchema = z.object({
  eventId: z.uuid(),
  targetKind: z.enum(["publication", "comment"]),
  targetId: z.uuid(),
  state: z.enum(["visible", "hidden"]),
});

export const resolveReportResultSchema = z.object({
  reportId: z.uuid(),
  state: z.enum(["actioned", "dismissed"]),
  eventId: z.uuid(),
});

export type PublicComment = z.infer<typeof publicCommentSchema>;
export type OpenReport = z.infer<typeof openReportSchema>;
export type ModerationTarget = z.infer<typeof moderationTargetSchema>;

export const hiddenContentSchema = z.object({
  items: z.array(
    z.object({
      targetKind: z.enum(["publication", "comment"]),
      targetId: z.uuid(),
      publicationId: z.uuid(),
      commentId: z.uuid().nullable(),
      preview: z.string().nullable(),
      reason: z.string(),
      hiddenAt: z.string(),
    }),
  ),
});

export type HiddenContent = z.infer<
  typeof hiddenContentSchema
>["items"][number];

/** The author's own hidden publications with the public moderation reason. */
export const hiddenMineSchema = z.object({
  items: z.array(
    z.object({
      publicationId: z.uuid(),
      label: z.string(),
      reason: z.string(),
      hiddenAt: z.string(),
    }),
  ),
});
