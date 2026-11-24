import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { signIn } from "@/app/[locale]/auth/sign-in/actions";
import { isLocale } from "@/lib/i18n/locales";
import { safeReturnPath } from "@/lib/auth/return-path";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type SignInPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; returnTo?: string }>;
};

async function SignInContent({ params, searchParams }: SignInPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const query = await searchParams;
  const copy = messages[locale].auth;
  const returnTo = safeReturnPath(query.returnTo, locale);
  const hasError =
    query.error === "invalid_credentials" || query.error === "invalid_input";

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-intro">
        <Link className="brand" href={`/${locale}`}>
          <span aria-hidden="true" className="auth-back">
            ←
          </span>
          Fork the City
        </Link>
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="hero-body">{copy.body}</p>
        </div>
      </section>
      <section className="auth-form-panel" aria-labelledby="sign-in-title">
        <h2 id="sign-in-title">{copy.formTitle}</h2>
        {hasError ? (
          <p className="form-error" role="alert">
            {copy.error}
          </p>
        ) : null}
        <form action={signIn}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor="email">{copy.email}</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
          <label htmlFor="password">{copy.password}</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={256}
          />
          <button className="button button-primary" type="submit">
            {copy.submit}
          </button>
        </form>
        <p className="auth-note">{copy.privacy}</p>
      </section>
    </main>
  );
}

export default function SignInPage(props: SignInPageProps) {
  return (
    <Suspense fallback={<main className="auth-page" aria-busy="true" />}>
      <SignInContent {...props} />
    </Suspense>
  );
}
