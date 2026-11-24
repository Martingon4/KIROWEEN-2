"use server";

import { redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n/locales";
import { createClient } from "@/lib/supabase/server";

export async function signOut(formData: FormData) {
  const requested = String(formData.get("locale") ?? "");
  const locale = isLocale(requested) ? requested : "es";

  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect(`/${locale}`);
}
