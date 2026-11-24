"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import { mapCommunityError } from "@/lib/http/database-errors";
import { sha256Hex } from "@/lib/http/mutation";
import { isLocale } from "@/lib/i18n/locales";
import {
  createCommentRequestSchema,
  createReportRequestSchema,
} from "@/lib/schemas/community";
import { createClient } from "@/lib/supabase/server";

const baseSchema = z.object({
  publicationId: z.uuid(),
  locale: z.string(),
});

function resolveLocale(value: FormDataEntryValue | null) {
  return typeof value === "string" && isLocale(value) ? value : "es";
}

/** Back to the publication with a status code. The page maps codes to localized text. */
function backTo(
  locale: string,
  publicationId: string,
  code: string,
  extra: Record<string, string> = {},
): never {
  const params = new URLSearchParams({ community: code, ...extra });
  redirect(
    `/${locale}/publications/${publicationId}?${params.toString()}#community`,
  );
}

function errorCode(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}) {
  const mapped = mapCommunityError(error);
  if (!mapped) return { code: "generic", extra: {} as Record<string, string> };
  if (mapped.code === "rate_limited") {
    const seconds = Number(mapped.details?.retryAfterSeconds ?? 60);
    return { code: "rate_limited", extra: { wait: String(seconds) } };
  }
  if (mapped.status === 404) return { code: "not_found", extra: {} };
  if (mapped.code === "invalid_anchor")
    return { code: "invalid_anchor", extra: {} };
  return { code: "generic", extra: {} };
}

/** Everything below runs with the caller's own session; anonymous callers go to sign-in. */
async function requireUser(locale: string, publicationId: string) {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/publications/${publicationId}`)}`,
    );
  }
  return supabase;
}

export async function addComment(formData: FormData) {
  const locale = resolveLocale(formData.get("locale"));
  const base = baseSchema.safeParse({
    publicationId: formData.get("publicationId"),
    locale,
  });
  if (!base.success) redirect(`/${locale}`);
  const { publicationId } = base.data;

  const featureRaw = formData.get("featureId");
  const input = createCommentRequestSchema.safeParse({
    body: formData.get("body"),
    featureId:
      typeof featureRaw === "string" && featureRaw !== "" ? featureRaw : null,
  });
  const key = String(formData.get("idempotencyKey") ?? "");
  if (!input.success || key.length < 8 || key.length > 200) {
    backTo(locale, publicationId, "invalid_comment");
  }

  const supabase = await requireUser(locale, publicationId);
  const featureId = input.data.featureId ?? null;
  const { error } = await supabase.rpc("create_comment", {
    p_publication_id: publicationId,
    p_feature_id: featureId,
    p_body: input.data.body,
    p_idempotency_key: key,
    p_payload_hash: sha256Hex(
      canonicalJson({ publicationId, featureId, body: input.data.body }),
    ),
  });
  if (error) {
    const mapped = errorCode(error);
    backTo(locale, publicationId, mapped.code, mapped.extra);
  }
  backTo(locale, publicationId, "commented");
}

export async function toggleSupport(formData: FormData) {
  const locale = resolveLocale(formData.get("locale"));
  const base = baseSchema.safeParse({
    publicationId: formData.get("publicationId"),
    locale,
  });
  if (!base.success) redirect(`/${locale}`);
  const { publicationId } = base.data;
  const supported = formData.get("supported") === "true";

  const supabase = await requireUser(locale, publicationId);
  const { error } = await supabase.rpc("set_support", {
    p_publication_id: publicationId,
    p_supported: supported,
  });
  if (error) {
    const mapped = errorCode(error);
    backTo(locale, publicationId, mapped.code, mapped.extra);
  }
  backTo(locale, publicationId, supported ? "supported" : "unsupported");
}

export async function retractComment(formData: FormData) {
  const locale = resolveLocale(formData.get("locale"));
  const base = baseSchema.safeParse({
    publicationId: formData.get("publicationId"),
    locale,
  });
  const commentId = z.uuid().safeParse(formData.get("commentId"));
  if (!base.success || !commentId.success) redirect(`/${locale}`);
  const { publicationId } = base.data;

  const supabase = await requireUser(locale, publicationId);
  const { error } = await supabase.rpc("retract_comment", {
    p_comment_id: commentId.data,
  });
  if (error) {
    const mapped = errorCode(error);
    backTo(locale, publicationId, mapped.code, mapped.extra);
  }
  backTo(locale, publicationId, "retracted");
}

export async function reportTarget(formData: FormData) {
  const locale = resolveLocale(formData.get("locale"));
  const base = baseSchema.safeParse({
    publicationId: formData.get("publicationId"),
    locale,
  });
  if (!base.success) redirect(`/${locale}`);
  const { publicationId } = base.data;

  const noteRaw = formData.get("note");
  const input = createReportRequestSchema.safeParse({
    targetKind: formData.get("targetKind"),
    targetId: formData.get("targetId"),
    reason: formData.get("reason"),
    note: typeof noteRaw === "string" && noteRaw.trim() !== "" ? noteRaw : null,
  });
  const key = String(formData.get("idempotencyKey") ?? "");
  if (!input.success || key.length < 8 || key.length > 200) {
    backTo(locale, publicationId, "invalid_report");
  }

  const supabase = await requireUser(locale, publicationId);
  const note = input.data.note ?? null;
  const { data, error } = await supabase.rpc("create_report", {
    p_target_kind: input.data.targetKind,
    p_target_id: input.data.targetId,
    p_reason: input.data.reason,
    p_note: note,
    p_idempotency_key: key,
    p_payload_hash: sha256Hex(
      canonicalJson({
        targetKind: input.data.targetKind,
        targetId: input.data.targetId,
        reason: input.data.reason,
        note,
      }),
    ),
  });
  if (error) {
    const mapped = errorCode(error);
    backTo(locale, publicationId, mapped.code, mapped.extra);
  }
  const duplicate = Boolean(
    (data as { duplicate?: unknown } | null)?.duplicate,
  );
  backTo(locale, publicationId, duplicate ? "report_duplicate" : "reported");
}
