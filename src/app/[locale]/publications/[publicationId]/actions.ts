"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import { sha256Hex } from "@/lib/http/mutation";
import { isLocale } from "@/lib/i18n/locales";
import { branchPayloadFingerprint } from "@/lib/schemas/branch";
import { createClient } from "@/lib/supabase/server";

const forkFormSchema = z.object({
  publicationId: z.uuid(),
  title: z.string().trim().min(1).max(100),
  locale: z.string(),
  idempotencyKey: z.string().min(8).max(200),
});

/**
 * Forks a visible publication into a new private branch. Anonymous submitters are sent
 * to sign in first; the fork itself always happens server-side with the caller's session.
 */
export async function forkPublication(formData: FormData) {
  const rawLocale = formData.get("locale");
  const locale =
    typeof rawLocale === "string" && isLocale(rawLocale) ? rawLocale : "es";
  const rawId = formData.get("publicationId");
  const publicationPath = z.uuid().safeParse(rawId).success
    ? `/${locale}/publications/${String(rawId)}`
    : null;
  if (!publicationPath) redirect(`/${locale}/branches?error=invalid_branch`);

  const input = forkFormSchema.safeParse({
    publicationId: rawId,
    title: formData.get("title"),
    locale: rawLocale,
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!input.success) redirect(`${publicationPath}?error=invalid_title`);

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(publicationPath)}`,
    );
  }

  const payloadHash = sha256Hex(
    canonicalJson(
      branchPayloadFingerprint({
        sourcePublicationId: input.data.publicationId,
        title: input.data.title,
      }),
    ),
  );
  const { data, error } = await supabase.rpc("fork_publication", {
    p_publication_id: input.data.publicationId,
    p_title: input.data.title,
    p_idempotency_key: input.data.idempotencyKey,
    p_payload_hash: payloadHash,
  });

  if (error) {
    // The publication went away between render and submit; that state has its own page.
    if (error.code === "P0002") {
      redirect(`/${locale}/publication-unavailable`);
    }
    redirect(`${publicationPath}?error=fork_failed`);
  }
  if (!data || typeof data !== "object" || !("branchId" in data)) {
    redirect(`${publicationPath}?error=fork_failed`);
  }

  redirect(`/${locale}/branches/${String(data.branchId)}`);
}

const mergeEntrySchema = z.object({
  publicationId: z.uuid(),
  branchId: z.uuid(),
  locale: z.string(),
});

/** Opens the merge preview for one of the caller's branches; it writes nothing. */
export async function startMerge(formData: FormData) {
  const input = mergeEntrySchema.safeParse({
    publicationId: formData.get("publicationId"),
    branchId: formData.get("branchId"),
    locale: formData.get("locale"),
  });
  const locale =
    input.success && isLocale(input.data.locale) ? input.data.locale : "es";
  if (!input.success) redirect(`/${locale}/branches`);
  redirect(
    `/${locale}/branches/${input.data.branchId}/merge?source=${input.data.publicationId}`,
  );
}
