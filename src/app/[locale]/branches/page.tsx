import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { createBranch } from "@/app/[locale]/branches/actions";
import { SignOutButton } from "@/features/editor/sign-out-button";
import { pilotSite } from "@/features/places/site-data";
import { isLocale } from "@/lib/i18n/locales";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type BranchesPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
};

async function BranchesContent({ params, searchParams }: BranchesPageProps) {
  await connection();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = messages[locale].branches;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/branches`)}`,
    );
  }

  const { data: branches, error } = await supabase
    .from("branches")
    .select("id,title,created_at,current_revision_id")
    .order("created_at", { ascending: false });

  return (
    <main className="branches-page" id="main-content">
      <header className="branches-header">
        <Link className="brand" href={`/${locale}`}>
          Fork the City
        </Link>
        <div className="header-actions">
          <span>{copy.privateLabel}</span>
          <SignOutButton
            label={copy.signOut}
            locale={locale}
            userId={claims.claims.sub}
          />
        </div>
      </header>
      <section className="branch-create" aria-labelledby="branch-title">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1 id="branch-title">{copy.title}</h1>
          <p className="hero-body">{copy.body}</p>
        </div>
        <form action={createBranch}>
          <input type="hidden" name="siteId" value={pilotSite.id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <label htmlFor="branch-name">{copy.nameLabel}</label>
          <input
            id="branch-name"
            name="title"
            required
            minLength={1}
            maxLength={100}
          />
          <p id="branch-help">{copy.nameHelp}</p>
          <button className="button button-primary" type="submit">
            {copy.submit}
          </button>
        </form>
      </section>
      {query.created ? (
        <p className="success-message" role="status">
          {copy.created}
        </p>
      ) : null}
      {query.error ? (
        <p className="form-error" role="alert">
          {copy.error}
        </p>
      ) : null}
      <section className="branch-list" aria-labelledby="your-branches">
        <div className="section-heading">
          <p className="section-index">{branches?.length ?? 0}</p>
          <h2 id="your-branches">{copy.listTitle}</h2>
        </div>
        {error ? <p className="form-error">{copy.loadError}</p> : null}
        {!error && branches?.length === 0 ? (
          <p className="empty-message">{copy.empty}</p>
        ) : null}
        {branches && branches.length > 0 ? (
          <ol>
            {branches.map((branch) => (
              <li key={branch.id}>
                <div>
                  <strong>{branch.title}</strong>
                  <span>
                    {copy.privateLabel} ·{" "}
                    <code>
                      {String(branch.current_revision_id).slice(0, 8)}
                    </code>
                  </span>
                </div>
                <Link
                  className="button button-secondary"
                  href={`/${locale}/branches/${branch.id}`}
                  aria-label={copy.openAria.replace("{title}", branch.title)}
                >
                  {copy.open}
                </Link>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </main>
  );
}

export default function BranchesPage(props: BranchesPageProps) {
  return (
    <Suspense fallback={<main className="branches-page" aria-busy="true" />}>
      <BranchesContent {...props} />
    </Suspense>
  );
}
