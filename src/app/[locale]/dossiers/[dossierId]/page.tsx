import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, cache } from "react";
import { DossierView } from "@/features/dossier/dossier-view";
import { pilotSite } from "@/features/places/site-data";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import {
  publicDossierSchema,
  publicationDossierSchema,
} from "@/lib/schemas/dossier";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type DossierPageProps = {
  params: Promise<{ locale: string; dossierId: string }>;
};

// One database read per request, shared by metadata and the page body.
const loadDossier = cache(async (dossierId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_dossier", {
    p_dossier_id: dossierId,
  });
  if (error) return { status: "error" as const };
  if (data === null) return { status: "not_found" as const };
  const parsed = publicDossierSchema.safeParse(data);
  return parsed.success
    ? { status: "found" as const, dossier: parsed.data }
    : { status: "error" as const };
});

export async function generateMetadata({
  params,
}: DossierPageProps): Promise<Metadata> {
  await connection();
  const { locale, dossierId } = await params;
  if (!isLocale(locale)) return {};
  const result = await loadDossier(dossierId);
  if (result.status !== "found") return { robots: { index: false } };
  // Public label only; never the decision note, the responsible, or the alias.
  return {
    title: `${result.dossier.publication.label} · ${messages[locale].dossier.title}`,
  };
}

async function DossierContent({ params }: DossierPageProps) {
  await connection();
  const { locale, dossierId } = await params;
  if (!isLocale(locale)) notFound();

  const result = await loadDossier(dossierId);
  if (result.status === "error")
    throw new Error("The dossier could not be loaded.");
  if (result.status === "not_found") notFound();
  const dossier = result.dossier;
  if (dossier.siteId !== pilotSite.id) notFound();

  const copy = messages[locale];
  const other: Locale = locale === "es" ? "en" : "es";

  // Only the "manage" link depends on the viewer; the dossier itself is public.
  const supabase = await createClient();
  const { data: lookup } = await supabase.rpc("get_publication_dossier", {
    p_publication_id: dossier.publicationId,
  });
  const publication = publicationDossierSchema.safeParse(lookup);
  const canManage = publication.success && publication.data.canManage;

  return (
    <>
      <a className="skip-link" href="#dossier-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}/dossiers`}>
          <span aria-hidden="true">←</span> {copy.dossier.listTitle}
        </Link>
        <Link
          href={`/${other}/dossiers/${dossier.dossierId}`}
          hrefLang={other}
          lang={other}
        >
          {copy.dossier.language}
        </Link>
      </header>
      <DossierView
        dossier={dossier}
        locale={locale}
        copy={copy.dossier}
        kinds={copy.editor.kinds}
        siteName={pilotSite.name[locale]}
        boundary={pilotSite.baseline.features[0].geometry}
        bounds={pilotSite.bounds}
        canManage={canManage}
      />
    </>
  );
}

export default function DossierPage(props: DossierPageProps) {
  return (
    <Suspense fallback={<main className="publication-page" aria-busy="true" />}>
      <DossierContent {...props} />
    </Suspense>
  );
}
