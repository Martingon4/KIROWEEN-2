import Link from "next/link";
import { notFound } from "next/navigation";
import { PlaceCatalog } from "@/features/places/place-catalog";
import { pilotSite } from "@/features/places/site-data";
import { isLocale } from "@/lib/i18n/locales";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type PageProps = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: PageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <>
      <PlaceCatalog
        locale={locale}
        messages={messages[locale]}
        site={pilotSite}
      />
      <nav
        className="dossier-home-link"
        aria-label={messages[locale].dossier.listTitle}
      >
        <Link href={`/${locale}/dossiers`}>
          {messages[locale].dossier.listLink}
        </Link>
      </nav>
    </>
  );
}
