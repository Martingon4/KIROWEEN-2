"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import { mapDossierError } from "@/lib/http/database-errors";
import { sha256Hex } from "@/lib/http/mutation";
import { isLocale } from "@/lib/i18n/locales";
import {
  correctionRequestSchema,
  evidenceRequestSchema,
  milestoneRequestSchema,
  milestoneUpdateRequestSchema,
  promoteDossierRequestSchema,
  responsibleRequestSchema,
  transitionRequestSchema,
} from "@/lib/schemas/dossier";
import { createClient } from "@/lib/supabase/server";

const localeOf = (value: FormDataEntryValue | null) =>
  typeof value === "string" && isLocale(value) ? value : "es";

/** Empty form fields mean "not provided". */
const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() !== "" ? value : null;
};

const idField = (formData: FormData, name: string) =>
  z.uuid().safeParse(formData.get(name));

function manageUrl(
  locale: string,
  dossierId: string,
  key: "saved" | "error",
  code: string,
) {
  return `/${locale}/dossiers/${dossierId}/manage?${key}=${encodeURIComponent(code)}`;
}

/** Codes the page can show; anything else becomes "generic". */
function errorCode(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}) {
  const mapped = mapDossierError(error);
  if (!mapped) return "generic";
  if (mapped.status === 404) return "not_found";
  return mapped.code;
}

async function sessionOrSignIn(locale: string, returnTo: string) {
  const supabase = await createClient();
  const { data: claims, error } = await supabase.auth.getClaims();
  if (error || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }
  return supabase;
}

function keyOf(formData: FormData) {
  const key = String(formData.get("idempotencyKey") ?? "");
  return key.length >= 8 && key.length <= 200 ? key : null;
}

/** From a publication page: creates the dossier and opens its management page. */
export async function promoteFromPublication(formData: FormData) {
  const locale = localeOf(formData.get("locale"));
  const publication = idField(formData, "publicationId");
  if (!publication.success) redirect(`/${locale}`);
  const publicationId = publication.data;
  const back = (code: string): never =>
    redirect(
      `/${locale}/publications/${publicationId}?dossierError=${encodeURIComponent(code)}#dossier`,
    );

  const name = field(formData, "responsibleName");
  const input = promoteDossierRequestSchema.safeParse({
    decisionNote: formData.get("decisionNote"),
    responsibleName: name,
    responsibleAuthorized:
      name !== null && formData.get("responsibleAuthorized") === "on",
    targetDate: field(formData, "targetDate"),
  });
  const key = keyOf(formData);
  if (!input.success || !key) back("invalid");
  // A name without the authorization checkbox is refused instead of silently dropped.
  if (input.success && name !== null && !input.data.responsibleAuthorized)
    back("invalid");

  const supabase = await sessionOrSignIn(
    locale,
    `/${locale}/publications/${publicationId}`,
  );
  const data = input.success ? input.data : null;
  if (!data) return back("invalid");
  const fingerprint = {
    publicationId,
    decisionNote: data.decisionNote,
    responsibleName: data.responsibleName ?? null,
    responsibleAuthorized: data.responsibleAuthorized ?? false,
    targetDate: data.targetDate ?? null,
  };
  const { data: result, error } = await supabase.rpc("promote_dossier", {
    p_publication_id: publicationId,
    p_decision_note: data.decisionNote,
    p_responsible_name: fingerprint.responsibleName,
    p_responsible_authorized: fingerprint.responsibleAuthorized,
    p_target_date: fingerprint.targetDate,
    p_idempotency_key: key as string,
    p_payload_hash: sha256Hex(canonicalJson(fingerprint)),
  });
  if (error) return back(errorCode(error));

  const dossier = result as { dossierId?: string; created?: boolean } | null;
  if (!dossier?.dossierId) return back("generic");
  redirect(
    manageUrl(
      locale,
      dossier.dossierId,
      "saved",
      dossier.created ? "promoted" : "exists",
    ),
  );
}

type Run = (
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: string,
) => PromiseLike<{
  error: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
  } | null;
}>;

async function perform(
  locale: string,
  dossierId: string,
  formData: FormData,
  savedCode: string,
  run: Run,
): Promise<never> {
  const key = keyOf(formData);
  if (!key) return redirect(manageUrl(locale, dossierId, "error", "invalid"));
  const supabase = await sessionOrSignIn(
    locale,
    `/${locale}/dossiers/${dossierId}/manage`,
  );
  const { error } = await run(supabase, key);
  if (error)
    return redirect(manageUrl(locale, dossierId, "error", errorCode(error)));
  return redirect(manageUrl(locale, dossierId, "saved", savedCode));
}

function target(formData: FormData) {
  const locale = localeOf(formData.get("locale"));
  const dossier = idField(formData, "dossierId");
  if (!dossier.success) redirect(`/${locale}`);
  return { locale, dossierId: dossier.data };
}

export async function saveResponsible(formData: FormData) {
  const { locale, dossierId } = target(formData);
  const name =
    formData.get("intent") === "remove"
      ? null
      : field(formData, "responsibleName");
  const authorized =
    name !== null && formData.get("responsibleAuthorized") === "on";
  const input = responsibleRequestSchema.safeParse({
    responsibleName: name,
    responsibleAuthorized: authorized,
  });
  if (!input.success || (name !== null && !authorized)) {
    redirect(manageUrl(locale, dossierId, "error", "invalid"));
  }
  const data = input.data;
  await perform(locale, dossierId, formData, "responsible", (supabase, key) =>
    supabase.rpc("set_dossier_responsible", {
      p_dossier_id: dossierId,
      p_responsible_name: data.responsibleName,
      p_responsible_authorized: data.responsibleAuthorized ?? false,
      p_idempotency_key: key,
      p_payload_hash: sha256Hex(
        canonicalJson({
          dossierId,
          responsibleName: data.responsibleName,
          responsibleAuthorized: data.responsibleAuthorized ?? false,
        }),
      ),
    }),
  );
}

export async function addMilestoneAction(formData: FormData) {
  const { locale, dossierId } = target(formData);
  const input = milestoneRequestSchema.safeParse({
    title: formData.get("title"),
    targetDate: formData.get("targetDate"),
  });
  if (!input.success)
    redirect(manageUrl(locale, dossierId, "error", "invalid"));
  const data = input.data;
  await perform(locale, dossierId, formData, "milestone", (supabase, key) =>
    supabase.rpc("add_milestone", {
      p_dossier_id: dossierId,
      p_title: data.title,
      p_target_date: data.targetDate,
      p_idempotency_key: key,
      p_payload_hash: sha256Hex(
        canonicalJson({
          dossierId,
          title: data.title,
          targetDate: data.targetDate,
        }),
      ),
    }),
  );
}

export async function updateMilestoneAction(formData: FormData) {
  const { locale, dossierId } = target(formData);
  const milestone = idField(formData, "milestoneId");
  const input = milestoneUpdateRequestSchema.safeParse({
    expectedStatus: formData.get("expectedStatus"),
    title: formData.get("title"),
    targetDate: formData.get("targetDate"),
    status: formData.get("status"),
  });
  if (!milestone.success || !input.success) {
    redirect(manageUrl(locale, dossierId, "error", "invalid"));
  }
  const milestoneId = milestone.data;
  const data = input.data;
  await perform(
    locale,
    dossierId,
    formData,
    "milestone_updated",
    (supabase, key) =>
      supabase.rpc("update_milestone", {
        p_milestone_id: milestoneId,
        p_expected_status: data.expectedStatus,
        p_title: data.title,
        p_target_date: data.targetDate,
        p_status: data.status,
        p_idempotency_key: key,
        p_payload_hash: sha256Hex(
          canonicalJson({
            milestoneId,
            expectedStatus: data.expectedStatus,
            title: data.title,
            targetDate: data.targetDate,
            status: data.status,
          }),
        ),
      }),
  );
}

export async function addEvidenceAction(formData: FormData) {
  const { locale, dossierId } = target(formData);
  const input = evidenceRequestSchema.safeParse({
    url: formData.get("url"),
    title: formData.get("title"),
    description: formData.get("description"),
    evidenceDate: formData.get("evidenceDate"),
  });
  if (!input.success) {
    // The link is the field people get wrong most often, so it has its own message.
    const urlIssue = input.error.issues.some(
      (issue) => issue.path[0] === "url",
    );
    redirect(
      manageUrl(
        locale,
        dossierId,
        "error",
        urlIssue ? "invalid_evidence_url" : "invalid",
      ),
    );
  }
  const data = input.data;
  await perform(locale, dossierId, formData, "evidence", (supabase, key) =>
    supabase.rpc("add_evidence", {
      p_dossier_id: dossierId,
      p_url: data.url,
      p_title: data.title,
      p_description: data.description,
      p_evidence_date: data.evidenceDate,
      p_idempotency_key: key,
      p_payload_hash: sha256Hex(
        canonicalJson({
          dossierId,
          url: data.url,
          title: data.title,
          description: data.description,
          evidenceDate: data.evidenceDate,
        }),
      ),
    }),
  );
}

export async function verifyEvidenceAction(formData: FormData) {
  const { locale, dossierId } = target(formData);
  const evidence = idField(formData, "evidenceId");
  if (!evidence.success)
    redirect(manageUrl(locale, dossierId, "error", "invalid"));
  const verified = formData.get("verified") === "true";
  const evidenceId = evidence.data;
  await perform(locale, dossierId, formData, "verified", (supabase) =>
    supabase.rpc("set_evidence_verified", {
      p_evidence_id: evidenceId,
      p_verified: verified,
    }),
  );
}

export async function transitionAction(formData: FormData) {
  const { locale, dossierId } = target(formData);
  const evidenceIds = formData
    .getAll("evidenceIds")
    .filter((value) => typeof value === "string");
  const input = transitionRequestSchema.safeParse({
    expectedState: formData.get("expectedState"),
    newState: formData.get("newState"),
    note: field(formData, "note"),
    observation: field(formData, "observation"),
    difference: field(formData, "difference"),
    evidenceIds,
  });
  if (!input.success)
    redirect(manageUrl(locale, dossierId, "error", "invalid"));
  const data = input.data;
  await perform(locale, dossierId, formData, "transition", (supabase, key) =>
    supabase.rpc("transition_dossier", {
      p_dossier_id: dossierId,
      p_expected_state: data.expectedState,
      p_new_state: data.newState,
      p_note: data.note ?? null,
      p_observation: data.observation ?? null,
      p_difference: data.difference ?? null,
      p_evidence_ids: data.evidenceIds,
      p_idempotency_key: key,
      p_payload_hash: sha256Hex(
        canonicalJson({
          dossierId,
          expectedState: data.expectedState,
          newState: data.newState,
          note: data.note ?? null,
          observation: data.observation ?? null,
          difference: data.difference ?? null,
          evidenceIds: [...data.evidenceIds].sort(),
        }),
      ),
    }),
  );
}

export async function revertAction(formData: FormData) {
  const { locale, dossierId } = target(formData);
  const input = correctionRequestSchema.safeParse({
    expectedState: formData.get("expectedState"),
    note: formData.get("note"),
  });
  if (!input.success)
    redirect(manageUrl(locale, dossierId, "error", "invalid"));
  const data = input.data;
  await perform(locale, dossierId, formData, "correction", (supabase, key) =>
    supabase.rpc("revert_last_status_change", {
      p_dossier_id: dossierId,
      p_expected_state: data.expectedState,
      p_note: data.note,
      p_idempotency_key: key,
      p_payload_hash: sha256Hex(
        canonicalJson({
          dossierId,
          expectedState: data.expectedState,
          note: data.note,
        }),
      ),
    }),
  );
}
