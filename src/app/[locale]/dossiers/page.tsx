import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { STATUS_SYMBOL } from "@/features/dossier/dossier-view";
import { pilotSite } from "@/features/places/site-data";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import { dossierListSchema } from "@/lib/schemas/dossier";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type ListPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ after?: string; afterId?: string }>;
};

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ListContent({ params, searchParams }: ListPageProps) {
  await connection();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const copy = messages[locale];
  const other: Locale = locale === "es" ? "en" : "es";

  const cursor =
    query.after &&
    query.afterId &&
    TIMESTAMP.test(query.after) &&
    UUID.test(query.afterId)
      ? { after: query.after, id: query.afterId }
      : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_public_dossiers", {
    p_site_id: pilotSite.id,
    p_after_updated_at: cursor?.after ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: 20,
  });
  const parsed = dossierListSchema.safeParse(data);
  if (error || !parsed.success)
    throw new Error("The dossiers could not be loaded.");

  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "America/Mexico_City",
  });

  return (
    <>
      <a className="skip-link" href="#dossiers-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {copy.dossier.backToPlace}
        </Link>
        <Link href={`/${other}/dossiers`} hrefLang={other} lang={other}>
          {copy.dossier.language}
        </Link>
      </header>
      <main className="publication-page" id="dossiers-main">
        <p className="eyebrow">{pilotSite.name[locale]}</p>
        <h1>{copy.dossier.listTitle}</h1>
        <p className="field-help">{copy.dossier.hypothetical}</p>
        {parsed.data.items.length === 0 ? (
          <p className="empty-message">{copy.dossier.listEmpty}</p>
        ) : (
          <ul className="publication-features">
            {parsed.data.items.map((item) => (
              <li key={item.dossierId}>
                <Link href={`/${locale}/dossiers/${item.dossierId}`}>
                  <strong>{item.label}</strong>
                </Link>
                <span>
                  <span aria-hidden="true">{STATUS_SYMBOL[item.status]} </span>
                  {copy.dossier.status[item.status]} ·{" "}
                  {date.format(new Date(item.updatedAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {parsed.data.nextCursor ? (
          <p>
            <Link
              className="button button-secondary"
              href={`/${locale}/dossiers?after=${encodeURIComponent(parsed.data.nextCursor.updatedAt)}&afterId=${parsed.data.nextCursor.id}`}
            >
              {copy.community.moreComments}
            </Link>
          </p>
        ) : null}
      </main>
    </>
  );
}

export default function DossiersPage(props: ListPageProps) {
  return (
    <Suspense fallback={<main className="publication-page" aria-busy="true" />}>
      <ListContent {...props} />
    </Suspense>
  );
}
