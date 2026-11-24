"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import { mapCommunityError } from "@/lib/http/database-errors";
import { sha256Hex } from "@/lib/http/mutation";
import { isLocale } from "@/lib/i18n/locales";
import {
  moderationActionRequestSchema,
  plainText,
} from "@/lib/schemas/community";
import { createClient } from "@/lib/supabase/server";

function localeOf(value: FormDataEntryValue | null) {
  return typeof value === "string" && isLocale(value) ? value : "es";
}

function backToPanel(
  locale: string,
  key: "status" | "error",
  code: string,
): never {
  redirect(`/${locale}/moderation?${key}=${code}`);
}

function errorKey(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}) {
  const mapped = mapCommunityError(error);
  if (!mapped) return "generic";
  if (mapped.status === 404) return "not_found";
  if (mapped.code === "moderation_state_unchanged") return "unchanged";
  if (mapped.code === "report_already_resolved") return "resolved";
  return "generic";
}

async function requireModerator(locale: string) {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/moderation`)}`,
    );
  }
  return supabase;
}

/** Hide or restore. The database decides who may; a stranger gets a plain not-found. */
export async function moderateContent(formData: FormData) {
  const locale = localeOf(formData.get("locale"));
  const privateNoteRaw = formData.get("privateNote");
  const reportRaw = formData.get("reportId");
  const input = moderationActionRequestSchema.safeParse({
    targetKind: formData.get("targetKind"),
    targetId: formData.get("targetId"),
    action: formData.get("action"),
    reason: formData.get("reason"),
    privateNote:
      typeof privateNoteRaw === "string" && privateNoteRaw.trim() !== ""
        ? privateNoteRaw
        : null,
    reportId:
      typeof reportRaw === "string" && reportRaw !== "" ? reportRaw : null,
  });
  const key = String(formData.get("idempotencyKey") ?? "");
  if (!input.success || key.length < 8 || key.length > 200) {
    backToPanel(locale, "error", "invalid");
  }

  const supabase = await requireModerator(locale);
  const privateNote = input.data.privateNote ?? null;
  const reportId = input.data.reportId ?? null;
  const { error } = await supabase.rpc("moderate_target", {
    p_target_kind: input.data.targetKind,
    p_target_id: input.data.targetId,
    p_action: input.data.action,
    p_reason: input.data.reason,
    p_private_note: privateNote,
    p_report_id: reportId,
    p_idempotency_key: key,
    p_payload_hash: sha256Hex(
      canonicalJson({
        targetKind: input.data.targetKind,
        targetId: input.data.targetId,
        action: input.data.action,
        reason: input.data.reason,
        privateNote,
        reportId,
      }),
    ),
  });
  if (error) backToPanel(locale, "error", errorKey(error));
  backToPanel(
    locale,
    "status",
    input.data.action === "hide" ? "hidden" : "restored",
  );
}

const dismissSchema = z.object({
  reportId: z.uuid(),
  note: plainText(1, 500),
});

export async function dismissReport(formData: FormData) {
  const locale = localeOf(formData.get("locale"));
  const input = dismissSchema.safeParse({
    reportId: formData.get("reportId"),
    note: formData.get("note"),
  });
  const key = String(formData.get("idempotencyKey") ?? "");
  if (!input.success || key.length < 8 || key.length > 200) {
    backToPanel(locale, "error", "invalid");
  }

  const supabase = await requireModerator(locale);
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: input.data.reportId,
    p_outcome: "dismissed",
    p_note: input.data.note,
    p_event_id: null,
    p_idempotency_key: key,
    p_payload_hash: sha256Hex(
      canonicalJson({
        reportId: input.data.reportId,
        outcome: "dismissed",
        note: input.data.note,
        eventId: null,
      }),
    ),
  });
  if (error) backToPanel(locale, "error", errorKey(error));
  backToPanel(locale, "status", "dismissed");
}
