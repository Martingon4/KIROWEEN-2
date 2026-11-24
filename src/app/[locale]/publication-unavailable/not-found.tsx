"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

/** Localized explanation for a missing, malformed, or hidden publication link. */
export default function PublicationUnavailable() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale === "en" ? "en" : "es";
  const copy = locale === "en" ? en : es;
  const p = copy.publication;

  return (
    <>
      <title>{`${p.unavailableTitle} · Fork the City`}</title>
      <a className="skip-link" href="#publication-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {p.backToPlace}
        </Link>
      </header>
      <main className="publication-page" id="publication-main">
        <p className="eyebrow">404</p>
        <h1>{p.unavailableTitle}</h1>
        <p className="publication-summary">{p.unavailableBody}</p>
        <Link className="button button-primary" href={`/${locale}`}>
          {p.backToPlace}
        </Link>
      </main>
    </>
  );
}
