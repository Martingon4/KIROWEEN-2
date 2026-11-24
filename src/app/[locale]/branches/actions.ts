"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canonicalJson } from "@/lib/geo/canonical";
import { sha256Hex } from "@/lib/http/mutation";
import { isLocale } from "@/lib/i18n/locales";
import { createClient } from "@/lib/supabase/server";

const branchFormSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
  locale: z.string(),
  idempotencyKey: z.string().min(8).max(200),
});

export async function createBranch(formData: FormData) {
  const input = branchFormSchema.safeParse({
    siteId: formData.get("siteId"),
    title: formData.get("title"),
    locale: formData.get("locale"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  const locale =
    input.success && isLocale(input.data.locale) ? input.data.locale : "es";
  if (!input.success) redirect(`/${locale}/branches?error=invalid_branch`);

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/branches`)}`,
    );
  }

  const payloadHash = sha256Hex(
    canonicalJson({ siteId: input.data.siteId, title: input.data.title }),
  );
  const { data, error } = await supabase.rpc("create_branch", {
    p_site_id: input.data.siteId,
    p_title: input.data.title,
    p_idempotency_key: input.data.idempotencyKey,
    p_payload_hash: payloadHash,
  });

  if (error || !data || typeof data !== "object" || !("branchId" in data)) {
    redirect(`/${locale}/branches?error=create_failed`);
  }

  redirect(
    `/${locale}/branches?created=${encodeURIComponent(String(data.branchId))}`,
  );
}
