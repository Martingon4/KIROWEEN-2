import Link from "next/link";
import { InteractiveMap } from "@/features/places/interactive-map";
import type { PublicSite } from "@/features/places/site-data";
import type { Locale } from "@/lib/i18n/locales";
import { projectGeometry, projectPolygonFeatures } from "@/lib/geo/project";
import type esMessages from "@/messages/es.json";

type Messages = typeof esMessages;

type PlaceCatalogProps = {
  locale: Locale;
  messages: Messages;
  site: PublicSite;
};

function ForkMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32">
      <path d="M7 4v9c0 4 3 7 7 7h11M7 13c0 4 3 7 7 7v8M25 14l5 6-5 6" />
    </svg>
  );
}

function PlaceSchematic({ messages, site }: Omit<PlaceCatalogProps, "locale">) {
  const bounds = site.osmContext.bbox;
  const reference = projectPolygonFeatures(site.baseline, bounds);
  const scenarios = projectPolygonFeatures(site.scenario, bounds);

  return (
    <figure className="place-schematic" aria-labelledby="place-map-title">
      <div className="map-toolbar">
        <div>
          <span className="map-kicker">{messages.map.fallback}</span>
          <h2 id="place-map-title">{messages.map.title}</h2>
        </div>
        <span className="map-scale" aria-label={messages.map.scale}>
          100 m
        </span>
      </div>
      <InteractiveMap
        ariaLabel={messages.map.aria}
        baseline={site.baseline}
        osmContext={site.osmContext}
        readyLabel={messages.map.interactiveReady}
        scenario={site.scenario}
        fallback={
          <svg
            className="map-canvas"
            role="img"
            aria-label={messages.map.aria}
            viewBox="0 0 1000 700"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern
                id="map-grid"
                width="50"
                height="50"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 50 0 L 0 0 0 50"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </pattern>
              <pattern
                id="market-hatch"
                width="18"
                height="18"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="18"
                  stroke="currentColor"
                  strokeWidth="7"
                />
              </pattern>
            </defs>
            <rect
              className="map-grid"
              width="1000"
              height="700"
              fill="url(#map-grid)"
            />
            {reference.map((feature) => (
              <polygon
                key={feature.id}
                className="map-boundary"
                points={feature.svgPoints}
              />
            ))}
            <g aria-hidden="true">
              {site.osmContext.features.map((feature) => {
                const shape = projectGeometry(feature.geometry, bounds);
                if (shape.shape === "point") {
                  return <circle key={feature.id} cx={shape.cx} cy={shape.cy} r="3" fill="#475569" />;
                }
                if (shape.shape === "line") {
                  return <polyline key={feature.id} points={shape.points} fill="none"
                    stroke="#64748b" strokeWidth="2"
                    strokeDasharray={feature.properties.kind === "street" ? undefined : "5 4"} />;
                }
                return <polygon key={feature.id} points={shape.points} fill="#c7beb2" stroke="#989188" />;
              })}
            </g>
            {scenarios.map((feature) => (
              <polygon
                key={feature.id}
                className={
                  feature.properties.kind === "shade_canopy"
                    ? "map-shade"
                    : "map-market"
                }
                points={feature.svgPoints}
              />
            ))}
            <g className="map-label" transform="translate(70 610)">
              <rect width="330" height="56" />
              <text x="20" y="35">
                19.0437° N · 98.1981° W
              </text>
            </g>
          </svg>
        }
      />
      <figcaption className="map-legend">
        <span>
          <i className="legend-line reference" />
          {messages.map.reference}
        </span>
        <span>{messages.map.osmContext}</span>
        <span>
          <i className="legend-line shade" />
          {messages.map.shade}
        </span>
        <span>
          <i className="legend-line market" />
          {messages.map.market}
        </span>
      </figcaption>
      <p className="map-status">
        <span aria-hidden="true" className="status-dot" />
        {messages.map.status}
      </p>
    </figure>
  );
}

export function PlaceCatalog({ locale, messages, site }: PlaceCatalogProps) {
  const otherLocale = locale === "es" ? "en" : "es";

  return (
    <>
      <a className="skip-link" href="#main-content">
        {messages.nav.skip}
      </a>
      <header className="site-header">
        <Link
          className="brand"
          href={`/${locale}`}
          aria-label={messages.nav.brand}
        >
          <ForkMark />
          <span>{messages.nav.brand}</span>
        </Link>
        <nav aria-label={messages.nav.aria}>
          <a href="#place">{messages.nav.places}</a>
          <a href="#features">{messages.nav.proposals}</a>
          <a href="#ledger">{messages.nav.about}</a>
        </nav>
        <Link
          className="language-link"
          href={`/${otherLocale}`}
          lang={otherLocale}
          hrefLang={otherLocale}
        >
          {messages.nav.language}
        </Link>
      </header>

      <main id="main-content">
        <section className="hero-section" id="place">
          <div className="hero-copy">
            <p className="eyebrow">{messages.hero.eyebrow}</p>
            <h1>{messages.hero.title}</h1>
            <p className="hero-body">{messages.hero.body}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#features">
                {messages.hero.primary}
              </a>
              <Link
                className="button button-secondary"
                href={`/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/branches`)}`}
              >
                {messages.hero.secondary}
              </Link>
            </div>
            <dl className="place-facts">
              <div>
                <dt>{messages.facts.area}</dt>
                <dd>{site.locality[locale]}</dd>
              </div>
              <div>
                <dt>{messages.facts.reference}</dt>
                <dd>{site.source.captureDate}</dd>
              </div>
              <div>
                <dt>{messages.facts.status}</dt>
                <dd>{messages.ledger.partial}</dd>
              </div>
            </dl>
          </div>
          <PlaceSchematic messages={messages} site={site} />
        </section>

        <section
          className="ledger-section"
          id="ledger"
          aria-labelledby="ledger-title"
        >
          <div className="section-heading">
            <p className="section-index">A — B</p>
            <h2 id="ledger-title">{messages.ledger.title}</h2>
          </div>
          <div className="ledger-row reference-row">
            <div className="ledger-label">
              <span className="status-symbol">R</span>
              {messages.ledger.referenceTitle}
            </div>
            <p>{messages.ledger.referenceBody}</p>
          </div>
          <div className="ledger-row scenario-row">
            <div className="ledger-label">
              <span className="status-symbol">H</span>
              {messages.ledger.scenarioTitle}
            </div>
            <p>{messages.ledger.scenarioBody}</p>
          </div>
          <div className="source-ledger">
            <h3>{messages.ledger.sourceTitle}</h3>
            <dl>
              <div>
                <dt>{messages.ledger.captured}</dt>
                <dd>{site.source.captureDate}</dd>
              </div>
              <div>
                <dt>{messages.ledger.license}</dt>
                <dd>{site.source.license}</dd>
              </div>
              <div>
                <dt>{messages.ledger.coverage}</dt>
                <dd>{messages.ledger.partial}</dd>
              </div>
            </dl>
            <a href={site.source.url} target="_blank" rel="noopener noreferrer">
              {messages.ledger.openSource}
            </a>
          </div>
        </section>

        <section
          className="features-section"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="section-heading">
            <p className="section-index">A + B</p>
            <h2 id="features-title">{messages.features.title}</h2>
          </div>
          <ol className="feature-list">
            <li>
              <span className="feature-key shade-key">A</span>
              <div>
                <h3>{messages.features.shade}</h3>
                <p>{messages.features.shadeDetail}</p>
              </div>
            </li>
            <li>
              <span className="feature-key market-key">B</span>
              <div>
                <h3>{messages.features.market}</h3>
                <p>{messages.features.marketDetail}</p>
              </div>
            </li>
          </ol>
          <aside className="conflict-note" aria-label={messages.map.conflict}>
            <span className="conflict-glyph" aria-hidden="true">
              A∩B
            </span>
            <div>
              <strong>{messages.map.conflict}</strong>
              <p>{messages.features.warning}</p>
            </div>
          </aside>
        </section>
      </main>

      <footer className="site-footer">
        <span>Fork the City · 2026</span>
        <span>
          {site.source.attribution} · {site.source.license}
        </span>
      </footer>
    </>
  );
}
