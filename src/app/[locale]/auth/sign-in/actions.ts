"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isLocale } from "@/lib/i18n/locales";
import { safeReturnPath } from "@/lib/auth/return-path";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(256),
  locale: z.string(),
  returnTo: z.string().max(2_048),
});

export async function signIn(formData: FormData) {
  const input = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
    returnTo: formData.get("returnTo"),
  });

  const locale =
    input.success && isLocale(input.data.locale) ? input.data.locale : "es";
  const returnTo = safeReturnPath(
    input.success ? input.data.returnTo : null,
    locale,
  );

  if (!input.success) {
    redirect(
      `/${locale}/auth/sign-in?error=invalid_input&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: input.data.email,
    password: input.data.password,
  });

  if (error) {
    redirect(
      `/${locale}/auth/sign-in?error=invalid_credentials&returnTo=${encodeURIComponent(returnTo)}`,
    );
  }

  redirect(returnTo);
}
