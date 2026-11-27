import Link from "next/link";
import { notFound } from "next/navigation";
import { TerrainWorkspace } from "@/features/terrain/terrain-workspace";
import { pilotSite } from "@/features/places/site-data";
import { isLocale } from "@/lib/i18n/locales";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { en, es };

export default async function TerrainPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = messages[locale];
  const other = locale === "es" ? "en" : "es";

  return (
    <>
      <a className="skip-link" href="#terrain-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}`}>
          Fork the City
        </Link>
        <Link href={`/${other}/terrain`} hrefLang={other} lang={other}>
          {copy.compare.language}
        </Link>
      </header>
      <main className="publication-page terrain-page" id="terrain-main">
        <div className="terrain-intro">
          <h1>{copy.terrain.title}</h1>
          <p>{copy.terrain.intro}</p>
        </div>
        <TerrainWorkspace
          copy={copy.terrain}
          locale={locale}
          shadeCopy={copy.compare.shadeScene}
          pilotContext={pilotSite.osmContext}
        />
      </main>
    </>
  );
}
