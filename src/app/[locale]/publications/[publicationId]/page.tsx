import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, cache } from "react";
import {
  forkPublication,
  startMerge,
} from "@/app/[locale]/publications/[publicationId]/actions";
import { createClient } from "@/lib/supabase/server";
import { CommunitySection } from "@/features/community/community-section";
import { promoteFromPublication } from "@/features/dossier/actions";
import { publicationDossierSchema } from "@/lib/schemas/dossier";
import { loadCommunity } from "@/features/community/load-community";
import { describeIntervention, fillTemplate } from "@/features/editor/describe";
import { pilotSite } from "@/features/places/site-data";
import { getPublicPublication } from "@/features/versions/public-publication";
import { RevisionPreview } from "@/features/versions/revision-preview";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type PublicationPageProps = {
  params: Promise<{ locale: string; publicationId: string }>;
  searchParams: Promise<{
    error?: string;
    community?: string;
    wait?: string;
    commentsCursor?: string;
    dossierError?: string;
  }>;
};

/** Seconds from the URL, clamped to a sane range; anything else is ignored. */
function parseWait(value: string | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null;
  const seconds = Number(value);
  return seconds >= 1 && seconds <= 3600 ? seconds : null;
}

// One database read per request, shared by metadata and the page body.
const loadPublication = cache(getPublicPublication);

export async function generateMetadata({
  params,
}: PublicationPageProps): Promise<Metadata> {
  await connection();
  const { locale, publicationId } = await params;
  if (!isLocale(locale)) return {};

  const result = await loadPublication(publicationId);
  if (result.status !== "found") return { robots: { index: false } };

  // Title and description use public, plain-text fields only; no alias or summary.
  return {
    title: `${result.publication.label} · Fork the City`,
    description: messages[locale].publication.metaDescription,
  };
}

async function PublicationContent({
  params,
  searchParams,
}: PublicationPageProps) {
  await connection();
  const { locale, publicationId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const error = query.error;

  const result = await loadPublication(publicationId);
  if (result.status === "error") {
    throw new Error("The publication could not be loaded.");
  }
  if (result.status === "not_found") notFound();

  const publication = result.publication;
  if (publication.siteId !== pilotSite.id) notFound();

  const copy = messages[locale];
  const p = copy.publication;
  const other: Locale = locale === "es" ? "en" : "es";
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  // The public projection is anonymous; only the merge entry reads the visitor's own
  // branches, through RLS, and only when a session exists.
  const sessionClient = await createClient();
  const { data: claims } = await sessionClient.auth.getClaims();
  const signedIn = Boolean(claims?.claims?.sub);
  const community = await loadCommunity(
    sessionClient,
    publication.publicationId,
    query.commentsCursor ?? null,
    signedIn,
  );
  const { data: dossierLookup } = await sessionClient.rpc(
    "get_publication_dossier",
    {
      p_publication_id: publication.publicationId,
    },
  );
  const dossierInfo = publicationDossierSchema.safeParse(dossierLookup);
  const dossierError =
    query.dossierError && Object.hasOwn(copy.dossier.errors, query.dossierError)
      ? copy.dossier.errors[
          query.dossierError as keyof typeof copy.dossier.errors
        ]
      : query.dossierError
        ? copy.dossier.errors.generic
        : null;
  const ownBranches = claims?.claims?.sub
    ? ((
        await sessionClient
          .from("branches")
          .select("id,title")
          .eq("site_id", publication.siteId)
          .order("created_at", { ascending: false })
          .limit(50)
      ).data ?? [])
    : null;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date(publication.publishedAt));

  return (
    <>
      <a className="skip-link" href="#publication-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {p.backToPlace}
        </Link>
        <Link
          href={`/${other}/publications/${publication.publicationId}`}
          hrefLang={other}
          lang={other}
        >
          {p.language}
        </Link>
      </header>
      <main className="publication-page" id="publication-main">
        <p className="eyebrow">
          {pilotSite.name[locale]} · {p.eyebrow}
        </p>
        <h1>{publication.label}</h1>
        <p className="publication-byline">
          {fillTemplate(p.byline, { date, alias: publication.authorAlias })}
        </p>
        <ul className="publication-notices">
          <li>{p.immutable}</li>
          <li>{p.hypothetical}</li>
        </ul>
        <p>
          <Link
            href={`/${locale}/compare?left=${encodeURIComponent(`baseline:${publication.baselineId}`)}&right=${encodeURIComponent(`publication:${publication.publicationId}`)}`}
          >
            {p.compareWithBaseline}
          </Link>
        </p>

        <div className="publication-layout">
          <section
            className="publication-preview"
            aria-labelledby="publication-preview-title"
          >
            <h2 id="publication-preview-title">{p.previewTitle}</h2>
            <RevisionPreview
              ariaLabel={p.previewAria}
              boundary={pilotSite.baseline.features[0].geometry}
              bounds={pilotSite.bounds}
              features={publication.features}
            />
          </section>

          <div>
            <section aria-labelledby="publication-summary-title">
              <h2 id="publication-summary-title">{p.summaryTitle}</h2>
              <p className="publication-summary">{publication.summary}</p>
            </section>
            <section aria-labelledby="publication-features-title">
              <h2 id="publication-features-title">{p.featuresTitle}</h2>
              <ul className="publication-features">
                {publication.features.map((feature) => (
                  <li key={feature.id}>
                    <strong>{feature.properties.label}</strong>
                    <span>
                      {copy.editor.kinds[feature.kind]} ·{" "}
                      {copy.editor.hypothetical} ·{" "}
                      {describeIntervention(
                        feature,
                        copy.editor.summary,
                        number,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        {community ? (
          <CommunitySection
            locale={locale}
            messages={copy.community}
            publicationId={publication.publicationId}
            data={community}
            anchors={publication.features.map((feature) => ({
              id: feature.id,
              label: feature.properties.label,
            }))}
            status={{
              code: query.community ?? null,
              wait: parseWait(query.wait),
            }}
          />
        ) : null}

        {dossierInfo.success &&
        (dossierInfo.data.dossierId || dossierInfo.data.canManage) ? (
          <section
            className="editor-form publication-fork"
            id="dossier"
            aria-labelledby="publication-dossier-title"
          >
            <h2 id="publication-dossier-title">{copy.dossier.title}</h2>
            {dossierError ? (
              <p className="field-error" role="alert">
                {dossierError}
              </p>
            ) : null}
            {dossierInfo.data.dossierId ? (
              <p>
                <Link
                  className="button button-secondary"
                  href={`/${locale}/dossiers/${dossierInfo.data.dossierId}`}
                >
                  {copy.dossier.openDossier}
                </Link>
              </p>
            ) : (
              <>
                <p className="field-help">{copy.dossier.promoteBody}</p>
                <form
                  action={promoteFromPublication}
                  className="community-form"
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input
                    type="hidden"
                    name="publicationId"
                    value={publication.publicationId}
                  />
                  <input
                    type="hidden"
                    name="idempotencyKey"
                    value={randomUUID()}
                  />
                  <label htmlFor="promote-note">
                    {copy.dossier.promoteNote}
                  </label>
                  <textarea
                    id="promote-note"
                    name="decisionNote"
                    rows={4}
                    required
                    maxLength={1000}
                    aria-describedby="promote-note-help"
                  />
                  <p className="field-help" id="promote-note-help">
                    {copy.dossier.promoteNoteHelp}
                  </p>
                  <label htmlFor="promote-responsible">
                    {copy.dossier.promoteResponsible}
                  </label>
                  <input
                    id="promote-responsible"
                    name="responsibleName"
                    maxLength={100}
                  />
                  <div className="consent-field">
                    <input
                      id="promote-authorized"
                      name="responsibleAuthorized"
                      type="checkbox"
                    />
                    <label htmlFor="promote-authorized">
                      {copy.dossier.promoteAuthorized}
                    </label>
                  </div>
                  <label htmlFor="promote-target">
                    {copy.dossier.promoteTarget}
                  </label>
                  <input id="promote-target" name="targetDate" type="date" />
                  <button className="button button-primary" type="submit">
                    {copy.dossier.promoteSubmit}
                  </button>
                </form>
              </>
            )}
          </section>
        ) : null}

        <section
          className="editor-form publication-fork"
          aria-labelledby="publication-fork-title"
        >
          <h2 id="publication-fork-title">{p.forkTitle}</h2>
          <p className="field-help">{p.forkBody}</p>
          {error === "fork_failed" || error === "invalid_title" ? (
            <p className="field-error" role="alert">
              {error === "invalid_title" ? p.forkInvalidTitle : p.forkFailed}
            </p>
          ) : null}
          <form action={forkPublication}>
            <input
              type="hidden"
              name="publicationId"
              value={publication.publicationId}
            />
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label htmlFor="fork-title">{p.forkNameLabel}</label>
            <input
              id="fork-title"
              name="title"
              required
              minLength={1}
              maxLength={100}
              defaultValue={fillTemplate(p.forkNameDefault, {
                label: publication.label,
              }).slice(0, 100)}
            />
            <button className="button button-primary" type="submit">
              {p.forkSubmit}
            </button>
          </form>
        </section>

        {ownBranches ? (
          <section
            className="editor-form publication-fork"
            aria-labelledby="publication-merge-title"
          >
            <h2 id="publication-merge-title">{copy.merge.entryTitle}</h2>
            <p className="field-help">{copy.merge.entryBody}</p>
            {ownBranches.length === 0 ? (
              <p className="empty-message">{copy.merge.entryNoBranches}</p>
            ) : (
              <form action={startMerge}>
                <input
                  type="hidden"
                  name="publicationId"
                  value={publication.publicationId}
                />
                <input type="hidden" name="locale" value={locale} />
                <label htmlFor="merge-branch">
                  {copy.merge.entryBranchLabel}
                </label>
                <select id="merge-branch" name="branchId" required>
                  {ownBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.title}
                    </option>
                  ))}
                </select>
                <button className="button button-secondary" type="submit">
                  {copy.merge.entrySubmit}
                </button>
              </form>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}

export default function PublicationPage(props: PublicationPageProps) {
  return (
    <Suspense fallback={<main className="publication-page" aria-busy="true" />}>
      <PublicationContent {...props} />
    </Suspense>
  );
}
