import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { fillTemplate } from "@/features/editor/describe";
import { pilotSite } from "@/features/places/site-data";
import { formatCentsRange } from "@/lib/format/money";
import { projectGeometry, type DrawableGeometry } from "@/lib/geo/project";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import {
  compareResultSchema,
  SNAPSHOT_REF_PATTERN,
  type CompareResult,
} from "@/lib/schemas/compare";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type ComparePageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ left?: string; right?: string; scenario?: string }>;
};

type CompareState =
  | { status: "found"; result: CompareResult }
  | { status: "not_found" }
  | { status: "incompatible" }
  | { status: "invalid" }
  | { status: "error" };

async function loadCompare(
  left: string,
  right: string,
  scenario: string | null,
): Promise<CompareState> {
  if (!SNAPSHOT_REF_PATTERN.test(left) || !SNAPSHOT_REF_PATTERN.test(right)) {
    return { status: "invalid" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("compare_revisions", {
    p_left: left,
    p_right: right,
    p_scenario_slug: scenario,
  });
  if (error) {
    if (error.code === "P0002") return { status: "not_found" };
    if (error.code === "22023") return { status: "invalid" };
    if (error.code === "FT422") return { status: "incompatible" };
    return { status: "error" };
  }
  const parsed = compareResultSchema.safeParse(data);
  return parsed.success
    ? { status: "found", result: parsed.data }
    : { status: "error" };
}

function ChangeMap({
  result,
  ariaLabel,
}: {
  result: CompareResult;
  ariaLabel: string;
}) {
  const bounds = pilotSite.bounds;
  const boundary = pilotSite.baseline.features[0].geometry as DrawableGeometry;
  const boundaryShape = projectGeometry(boundary, bounds);

  return (
    <svg
      className="editor-preview compare-map"
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 1000 700"
    >
      <defs>
        <pattern
          id="cmp-pattern-added"
          width="26"
          height="26"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="26" height="26" fill="rgba(21, 128, 61, 0.28)" />
          <line x1="0" y1="0" x2="0" y2="26" stroke="#15803d" strokeWidth="7" />
        </pattern>
        <pattern
          id="cmp-pattern-removed"
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
        >
          <rect width="22" height="22" fill="rgba(185, 28, 28, 0.10)" />
          <path d="M0 0 L22 22 M22 0 L0 22" stroke="#b91c1c" strokeWidth="5" />
        </pattern>
      </defs>
      {boundaryShape.shape === "polygon" ? (
        <polygon className="map-boundary" points={boundaryShape.points} />
      ) : null}
      {result.features.map((feature) => {
        const side = feature.class === "removed" ? feature.left : feature.right;
        if (!side) return null;
        const shape = projectGeometry(
          side.geometry as DrawableGeometry,
          bounds,
        );
        const className = `cmp-feature cmp-${feature.class}`;
        const fill =
          feature.class === "added"
            ? "url(#cmp-pattern-added)"
            : feature.class === "removed"
              ? "url(#cmp-pattern-removed)"
              : "rgba(3, 105, 161, 0.30)";
        if (shape.shape === "point") {
          return (
            <circle
              key={feature.id}
              className={className}
              cx={shape.cx}
              cy={shape.cy}
              r="18"
              fill={fill}
            />
          );
        }
        if (shape.shape === "line") {
          return (
            <polyline
              key={feature.id}
              className={className}
              points={shape.points}
              fill="none"
            />
          );
        }
        return (
          <polygon
            key={feature.id}
            className={className}
            points={shape.points}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

async function CompareContent({ params, searchParams }: ComparePageProps) {
  await connection();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const copy = messages[locale];
  const c = copy.compare;
  const other: Locale = locale === "es" ? "en" : "es";

  const left = query.left ?? "";
  const right = query.right ?? "";
  const scenario = query.scenario ?? null;
  const state =
    left && right
      ? await loadCompare(left, right, scenario)
      : { status: "invalid" as const };

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const switchQuery =
    left && right
      ? `?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}${scenario ? `&scenario=${encodeURIComponent(scenario)}` : ""}`
      : "";

  return (
    <>
      <a className="skip-link" href="#compare-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {c.backToPlace}
        </Link>
        <Link
          href={`/${other}/compare${switchQuery}`}
          hrefLang={other}
          lang={other}
        >
          {c.language}
        </Link>
      </header>
      <main className="publication-page" id="compare-main">
        {state.status !== "found" ? (
          <>
            <p className="eyebrow">{c.title}</p>
            <h1>
              {state.status === "not_found"
                ? c.notFoundTitle
                : state.status === "incompatible"
                  ? c.incompatibleTitle
                  : c.missingTitle}
            </h1>
            <p className="publication-summary">
              {state.status === "not_found"
                ? c.notFoundBody
                : state.status === "incompatible"
                  ? c.incompatibleBody
                  : state.status === "error"
                    ? c.errorBody
                    : c.missingBody}
            </p>
            <Link className="button button-primary" href={`/${locale}`}>
              {c.backToPlace}
            </Link>
          </>
        ) : (
          (() => {
            const result = state.result;
            if (result.siteId !== pilotSite.id) notFound();
            const currency = result.right.cost.currency ?? "MXN";
            const sideName = (side: CompareResult["left"]) =>
              side.refKind === "baseline" ? c.baselineLabel : side.label;
            const changedLabel = (
              feature: CompareResult["features"][number],
            ) => {
              const props = (feature.right ?? feature.left)?.properties as
                { label?: unknown } | undefined;
              return typeof props?.label === "string"
                ? props.label
                : feature.id.slice(0, 8);
            };
            return (
              <>
                <p className="eyebrow">
                  {pilotSite.name[locale]} · {c.eyebrow}
                </p>
                <h1>{c.title}</h1>
                <p className="publication-byline">
                  {fillTemplate(c.scenarioLine, {
                    slug: result.scenario.slug,
                    local: result.scenario.localDatetime,
                    engine: result.engineVersion,
                  })}
                </p>
                <ul className="publication-notices">
                  <li>{c.hypothetical}</li>
                  {result.right.cost.label !== "sourced" ||
                  result.left.cost.label !== "sourced" ? (
                    <li>
                      {fillTemplate(c.illustrative, {
                        date: result.right.cost.priceDate ?? "",
                      })}
                    </li>
                  ) : null}
                </ul>

                <section aria-labelledby="compare-metrics-title">
                  <h2 id="compare-metrics-title">{c.metricsTitle}</h2>
                  {/* Focusable so keyboard users can scroll the table at 360 px. */}
                  <div
                    className="compare-table-wrap"
                    role="region"
                    aria-labelledby="compare-metrics-title"
                    tabIndex={0}
                  >
                    <table className="compare-table">
                      <thead>
                        <tr>
                          <th scope="col">{c.indicatorColumn}</th>
                          <th scope="col">{sideName(result.left)}</th>
                          <th scope="col">{sideName(result.right)}</th>
                          <th scope="col">{c.deltaColumn}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">{c.shadeM2}</th>
                          <td>
                            {number.format(result.left.analysis.shade.m2)}
                          </td>
                          <td>
                            {number.format(result.right.analysis.shade.m2)}
                          </td>
                          <td>{number.format(result.metricDeltas.shadeM2)}</td>
                        </tr>
                        <tr>
                          <th scope="row">{c.shadePct}</th>
                          <td>
                            {number.format(result.left.analysis.shade.pct)} %
                          </td>
                          <td>
                            {number.format(result.right.analysis.shade.pct)} %
                          </td>
                          <td>
                            {number.format(result.metricDeltas.shadePct)} %
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">{c.remainingM2}</th>
                          <td>
                            {number.format(
                              result.left.analysis.occupancy.remainingM2,
                            )}
                          </td>
                          <td>
                            {number.format(
                              result.right.analysis.occupancy.remainingM2,
                            )}
                          </td>
                          <td>
                            {number.format(result.metricDeltas.remainingM2)}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">{c.crossingLengthM}</th>
                          <td>
                            {number.format(
                              result.left.analysis.occupancy.crossingLengthM,
                            )}
                          </td>
                          <td>
                            {number.format(
                              result.right.analysis.occupancy.crossingLengthM,
                            )}
                          </td>
                          <td>
                            {number.format(result.metricDeltas.crossingLengthM)}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">{c.costRange}</th>
                          <td>
                            {formatCentsRange(
                              result.left.cost.totalLowCents,
                              result.left.cost.totalHighCents,
                              currency,
                              locale,
                            )}
                          </td>
                          <td>
                            {formatCentsRange(
                              result.right.cost.totalLowCents,
                              result.right.cost.totalHighCents,
                              currency,
                              locale,
                            )}
                          </td>
                          <td>
                            {result.catalogCompatible && result.costDelta ? (
                              formatCentsRange(
                                result.costDelta.totalLowCents,
                                result.costDelta.totalHighCents,
                                currency,
                                locale,
                              )
                            ) : (
                              <span>{c.costIncompatible}</span>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {result.left.analysis.shade.coverageIncomplete ||
                  result.right.analysis.shade.coverageIncomplete ? (
                    <p className="field-help">{c.coverageNote}</p>
                  ) : null}
                  {result.right.cost.partial || result.left.cost.partial ? (
                    <p className="field-help">
                      {fillTemplate(c.partialCost, {
                        concepts: [
                          ...new Set([
                            ...result.left.cost.unknownConcepts,
                            ...result.right.cost.unknownConcepts,
                          ]),
                        ]
                          .map(
                            (concept) =>
                              copy.editor.kinds[
                                concept as keyof typeof copy.editor.kinds
                              ] ?? concept,
                          )
                          .join(", "),
                      })}
                    </p>
                  ) : null}
                </section>

                <section aria-labelledby="compare-map-title">
                  <h2 id="compare-map-title">{c.mapTitle}</h2>
                  <p className="field-help">
                    {fillTemplate(c.countsLine, {
                      added: result.counts.added,
                      removed: result.counts.removed,
                      modified: result.counts.modified,
                      equal: result.counts.equal,
                    })}
                  </p>
                  <div className="publication-preview">
                    <ChangeMap result={result} ariaLabel={c.mapAria} />
                  </div>
                  <ul className="compare-legend">
                    <li>
                      <svg width="34" height="24" aria-hidden="true">
                        <rect
                          width="34"
                          height="24"
                          fill="url(#cmp-pattern-added)"
                          stroke="#15803d"
                          strokeWidth="2"
                        />
                      </svg>
                      {c.legendAdded}
                    </li>
                    <li>
                      <svg width="34" height="24" aria-hidden="true">
                        <rect
                          width="34"
                          height="24"
                          fill="url(#cmp-pattern-removed)"
                          stroke="#b91c1c"
                          strokeWidth="2"
                          strokeDasharray="5 3"
                        />
                      </svg>
                      {c.legendRemoved}
                    </li>
                    <li>
                      <svg width="34" height="24" aria-hidden="true">
                        <rect
                          width="34"
                          height="24"
                          fill="rgba(3, 105, 161, 0.30)"
                          stroke="#075985"
                          strokeWidth="3"
                          strokeDasharray="2 3"
                        />
                      </svg>
                      {c.legendModified}
                    </li>
                  </ul>
                </section>

                <section aria-labelledby="compare-changes-title">
                  <h2 id="compare-changes-title">{c.changesTitle}</h2>
                  {result.features.length === 0 ? (
                    <p className="empty-message">{c.noChanges}</p>
                  ) : (
                    <div
                      className="compare-table-wrap"
                      role="region"
                      aria-labelledby="compare-changes-title"
                      tabIndex={0}
                    >
                      <table className="compare-table">
                        <thead>
                          <tr>
                            <th scope="col">{c.featureColumn}</th>
                            <th scope="col">{c.changeColumn}</th>
                            <th scope="col">{c.detailColumn}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.features.map((feature) => (
                            <tr key={feature.id}>
                              <th scope="row">{changedLabel(feature)}</th>
                              <td>
                                <span
                                  className={`cmp-badge cmp-badge-${feature.class}`}
                                >
                                  {c.classes[feature.class]}
                                </span>
                              </td>
                              <td>
                                {copy.editor.kinds[
                                  ((feature.right ?? feature.left)?.kind ??
                                    "") as keyof typeof copy.editor.kinds
                                ] ?? (feature.right ?? feature.left)?.kind}
                                {feature.changedKeys.length > 0
                                  ? ` · ${fillTemplate(c.changedKeys, {
                                      keys: feature.changedKeys.join(", "),
                                    })}`
                                  : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            );
          })()
        )}
      </main>
    </>
  );
}

export default function ComparePage(props: ComparePageProps) {
  return (
    <Suspense fallback={<main className="publication-page" aria-busy="true" />}>
      <CompareContent {...props} />
    </Suspense>
  );
}
