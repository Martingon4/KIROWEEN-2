"use client";

import { signOut } from "@/app/[locale]/auth/sign-out/actions";
import { clearUserDrafts } from "@/features/editor/draft";
import type { Locale } from "@/lib/i18n/locales";

type SignOutButtonProps = {
  label: string;
  locale: Locale;
  userId: string;
};

/** Clears this account's local drafts before ending the session on a shared device. */
export function SignOutButton({ label, locale, userId }: SignOutButtonProps) {
  return (
    <form
      action={signOut}
      onSubmit={() => {
        clearUserDrafts(window.localStorage, userId);
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <button className="text-button" type="submit">
        {label}
      </button>
    </form>
  );
}
