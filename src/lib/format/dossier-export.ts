import { formatCentsRange } from "@/lib/format/money";
import { number, text, toCsv, type CsvCell } from "@/lib/format/csv";
import {
  projectGeometry,
  type BoundingBox,
  type DrawableGeometry,
} from "@/lib/geo/project";
import type { PublicDossier } from "@/lib/schemas/dossier";
import type esMessages from "@/messages/es.json";

/** Fills {name} placeholders; unknown names stay as written. */
function fillTemplate(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

type DossierCopy = (typeof esMessages)["dossier"];
type KindCopy = (typeof esMessages)["editor"]["kinds"];

/** Escapes text for an HTML text node or a double-quoted attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSV_HEADER = [
  "concept",
  "code",
  "unit",
  "quantity",
  "formula",
  "status",
  "amount_low",
  "amount_high",
  "currency",
  "is_assumption",
  "assumption_owner",
  "assumption_date",
  "budget_label",
  "catalog_source",
  "price_date",
  "rounding",
  "scenario",
  "generated_at",
] as const;

const cents = (value: number | null) => (value === null ? null : value / 100);

/** Cost concepts as CSV: one row per concept plus a TOTAL row. */
export function buildCostCsv(
  dossier: PublicDossier,
  generatedAt: Date,
): string {
  const cost = dossier.snapshot.cost;
  const common = (): CsvCell[] => [
    text(cost.label),
    text(cost.source),
    text(cost.priceDate),
    text(cost.rounding),
    text(dossier.snapshot.scenario.slug),
    text(generatedAt.toISOString()),
  ];

  const rows: CsvCell[][] = cost.lines.map((line) => [
    text(line.concept),
    text(line.code),
    text(line.unit),
    number(line.quantity, 2),
    text(line.formula),
    text(line.status),
    number(cents(line.amountLowCents), 2),
    number(cents(line.amountHighCents), 2),
    text(cost.currency),
    text(line.isAssumption ? "true" : "false"),
    text(line.assumptionOwner),
    text(line.assumptionDate),
    ...common(),
  ]);

  rows.push([
    text("TOTAL"),
    text(""),
    text(""),
    number(null),
    text(""),
    text(cost.partial ? "total_partial" : "total"),
    number(cents(cost.totalLowCents), 2),
    number(cents(cost.totalHighCents), 2),
    text(cost.currency),
    text(""),
    text(""),
    text(""),
    ...common(),
  ]);

  return toCsv(CSV_HEADER, rows);
}

/** Assumptions of the cost and shade models, as a documented JSON object. */
export function buildAssumptionsJson(
  dossier: PublicDossier,
  generatedAt: Date,
) {
  const { snapshot } = dossier;
  return {
    schemaVersion: 1,
    dossierId: dossier.dossierId,
    publicationId: dossier.publicationId,
    scenario: snapshot.scenario,
    engine: {
      version: snapshot.analysis.engineVersion,
      generator: snapshot.inputs.generator,
      datasetChecksum: snapshot.inputs.datasetChecksum,
    },
    referenceSurface: snapshot.analysis.referenceSurface,
    shade: {
      coverage: snapshot.analysis.shade.coverage,
      coverageIncomplete: snapshot.analysis.shade.coverageIncomplete,
      assumptions: snapshot.analysis.shade.assumptions,
    },
    catalog: {
      versionId: snapshot.cost.catalogVersionId,
      source: snapshot.cost.source ?? null,
      priceDate: snapshot.cost.priceDate ?? null,
    },
    currency: snapshot.cost.currency,
    rounding: snapshot.cost.rounding ?? null,
    budgetLabel: snapshot.cost.label,
    partial: snapshot.cost.partial,
    unknownConcepts: snapshot.cost.unknownConcepts,
    assumptions: snapshot.cost.lines
      .filter((line) => line.isAssumption)
      .map((line) => ({
        code: line.code,
        concept: line.concept,
        owner: line.assumptionOwner,
        date: line.assumptionDate,
      })),
    generatedAt: generatedAt.toISOString(),
  };
}

const FEATURE_CLASS_STYLE: Record<string, string> = {
  shade_canopy: "fill:rgba(3,105,161,.58);stroke:#075985;stroke-width:6",
  temporary_market:
    "fill:rgba(245,158,11,.42);stroke:#92400e;stroke-width:6;stroke-dasharray:14 6",
  shade_tree: "fill:#15803d;stroke:#14532d;stroke-width:5",
  urban_object: "fill:#cc9159;stroke:#653f24;stroke-width:3",
  proposed_crossing:
    "fill:none;stroke:#0f172a;stroke-width:14;stroke-dasharray:10 8",
};

/** "fill:#fff;stroke-width:6" -> ` fill="#fff" stroke-width="6"`: attributes survive a strict CSP. */
function presentation(style: string): string {
  return style
    .split(";")
    .filter(Boolean)
    .map((pair) => {
      const [name, ...value] = pair.split(":");
      return ` ${name}="${escapeHtml(value.join(":"))}"`;
    })
    .join("");
}
/** Static SVG of the proposal over the site boundary (no scripts, no external assets). */
export function buildPreviewSvg(
  dossier: PublicDossier,
  boundary: DrawableGeometry,
  bounds: BoundingBox,
  ariaLabel: string,
): string {
  const boundaryShape = projectGeometry(boundary, bounds);
  const parts = [
    `<svg viewBox="0 0 1000 700" role="img" aria-label="${escapeHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="1000" height="700" fill="#e2e8f0"/>`,
  ];
  if (boundaryShape.shape === "polygon") {
    parts.push(
      `<polygon points="${escapeHtml(boundaryShape.points)}"${presentation("fill:#f8fafc;stroke:#0f172a;stroke-width:6;stroke-dasharray:14 8")}/>`,
    );
  }
  for (const feature of dossier.publication.features) {
    const shape = projectGeometry(feature.geometry as DrawableGeometry, bounds);
    const style =
      FEATURE_CLASS_STYLE[feature.kind] ??
      "fill:none;stroke:#0f172a;stroke-width:6";
    if (shape.shape === "point") {
      parts.push(
        `<circle cx="${shape.cx}" cy="${shape.cy}" r="16"${presentation(style)}/>`,
      );
    } else if (shape.shape === "line") {
      parts.push(
        `<polyline points="${escapeHtml(shape.points)}"${presentation(style)}/>`,
      );
    } else {
      parts.push(
        `<polygon points="${escapeHtml(shape.points)}"${presentation(style)}/>`,
      );
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

export const DOSSIER_HTML_STYLES = `
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 52rem; padding: 2rem 1.25rem 4rem; font: 16px/1.5 system-ui, sans-serif; color: #0f172a; }
  h1 { font-size: 2rem; line-height: 1.15; margin: 0 0 .5rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 .5rem; border-bottom: 2px solid #0f172a; padding-bottom: .25rem; }
  p, li { overflow-wrap: anywhere; }
  .eyebrow { font-weight: 700; color: #075985; margin: 0; }
  .notice { border-left: 5px solid #92400e; background: #fef3c7; padding: .6rem .9rem; margin: .75rem 0; font-weight: 700; }
  .status { display: inline-block; border: 2px solid #0f172a; padding: .1rem .6rem; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { border: 1px solid #94a3b8; padding: .35rem .5rem; text-align: left; vertical-align: top; }
  th { background: #e2e8f0; }
  svg { width: 100%; height: auto; border: 1px solid #0f172a; }
  ul { padding-left: 1.2rem; }
  .meta { color: #334155; font-size: .9rem; }
  @media print { body { padding: 0; } a { color: inherit; } h2 { break-after: avoid; } li, tr { break-inside: avoid; } }
`;

const dateFormat = (locale: string, timeZone: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone });

/** A standalone, printable, script-free HTML document. Every dynamic value is escaped. */
export function buildDossierHtml(input: {
  dossier: PublicDossier;
  locale: "es" | "en";
  copy: DossierCopy;
  kinds: KindCopy;
  previewSvg: string;
  siteName: string;
  generatedAt: Date;
}): string {
  const { dossier, locale, copy, kinds, previewSvg, siteName, generatedAt } =
    input;
  const e = escapeHtml;
  const timeZone = dossier.snapshot.scenario.timezone;
  const day = dateFormat(locale, timeZone);
  const long = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(iso));
  const dateOnly = (value: string) =>
    day.format(new Date(`${value}T12:00:00Z`));
  const number0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const cost = dossier.snapshot.cost;
  const currency = cost.currency ?? "MXN";

  const lines = cost.lines
    .map(
      (line) => `<tr>
        <td>${e(kinds[line.concept as keyof KindCopy] ?? line.concept)}</td>
        <td>${number0.format(line.quantity)}</td>
        <td>${e(line.unit ?? "")}</td>
        <td>${line.amountLowCents === null ? e(copy.unpriced) : e(formatCentsRange(line.amountLowCents, line.amountLowCents, currency, locale))}</td>
        <td>${line.amountHighCents === null ? e(copy.unpriced) : e(formatCentsRange(line.amountHighCents, line.amountHighCents, currency, locale))}</td>
        <td>${line.isAssumption ? e(fillTemplate(copy.assumptionTag, { owner: line.assumptionOwner ?? "", date: line.assumptionDate ?? "" })) : ""}</td>
      </tr>`,
    )
    .join("");

  const milestones = dossier.milestones.length
    ? `<ul>${dossier.milestones
        .map(
          (milestone) =>
            `<li>${e(fillTemplate(copy.milestoneLine, { title: milestone.title, date: dateOnly(milestone.targetDate) }))} — <strong>${e(copy.milestoneStatus[milestone.status])}</strong></li>`,
        )
        .join("")}</ul>`
    : `<p>${e(copy.milestonesEmpty)}</p>`;

  const evidence = dossier.evidence.length
    ? `<ul>${dossier.evidence
        .map(
          (
            item,
          ) => `<li><strong>${e(item.title)}</strong><br>${e(item.description)}<br>
            <span class="meta">${e(fillTemplate(copy.evidenceRecordedBy, { alias: item.recordedByAlias, date: dateOnly(item.evidenceDate) }))} ·
            ${item.verifiedByTeam ? e(fillTemplate(copy.evidenceVerified, { alias: item.verifiedByAlias ?? "" })) : e(copy.evidenceUnverified)}</span><br>
            <span class="meta">${e(fillTemplate(copy.evidenceDomain, { host: item.host }))} ·
            ${
              item.url.startsWith("https://")
                ? `<a href="${e(item.url)}" rel="noopener noreferrer nofollow" target="_blank">${e(copy.evidenceOpen)}</a>`
                : e(item.url)
            }</span></li>`,
        )
        .join("")}</ul>`
    : `<p>${e(copy.evidenceEmpty)}</p>`;

  const timeline = `<ol>${dossier.events
    .map((event) => {
      const change =
        event.newState !== null
          ? ` — ${e(
              fillTemplate(copy.stateChange, {
                from: event.previousState
                  ? copy.status[event.previousState]
                  : "—",
                to: copy.status[event.newState],
              }),
            )}`
          : "";
      const extras = [
        event.note ? `<br>${e(event.note)}` : "",
        event.observation
          ? `<br><em>${e(copy.observationLabel)}:</em> ${e(event.observation)}`
          : "",
        event.difference
          ? `<br><em>${e(copy.differenceLabel)}:</em> ${e(event.difference)}`
          : "",
        event.correctsSeq !== null
          ? `<br>${e(fillTemplate(copy.correctsLabel, { seq: event.correctsSeq }))}`
          : "",
      ].join("");
      return `<li><strong>${e(copy.eventKinds[event.kind])}</strong>${change}<br><span class="meta">${e(fillTemplate(copy.eventLine, { date: long(event.createdAt), actor: event.actorAlias }))}</span>${extras}</li>`;
    })
    .join("")}</ol>`;

  const total = formatCentsRange(
    cost.totalLowCents,
    cost.totalHighCents,
    currency,
    locale,
  );
  const added = dossier.comparison.counts.added;

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(dossier.publication.label)} · ${e(copy.title)}</title>
<style>${DOSSIER_HTML_STYLES}</style>
</head>
<body>
<p class="eyebrow">${e(siteName)} · ${e(copy.eyebrow)}</p>
<h1>${e(dossier.publication.label)}</h1>
<p><span class="status">${e(fillTemplate(copy.statusLine, { status: copy.status[dossier.status] }))}</span></p>
<p class="notice">${e(copy.hypothetical)}</p>
<p class="meta">${e(fillTemplate(copy.authorLine, { date: long(dossier.publication.publishedAt), alias: dossier.publication.authorAlias }))}</p>

<h2>${e(copy.decisionTitle)}</h2>
<p>${e(dossier.decisionNote)}</p>
<p><strong>${e(copy.responsibleLabel)}:</strong> ${dossier.responsibleName ? e(dossier.responsibleName) : e(copy.responsibleNone)}<br>
<strong>${e(copy.targetLabel)}:</strong> ${dossier.targetDate ? e(dateOnly(dossier.targetDate)) : e(copy.targetNone)}</p>

<h2>${e(copy.proposalTitle)}</h2>
<p>${e(dossier.publication.summary)}</p>
<p class="meta">${e(copy.proposalNote)}</p>
${previewSvg}
<ul>${dossier.publication.features
    .map(
      (feature) =>
        `<li>${e(feature.properties.label)} — ${e(kinds[feature.kind as keyof KindCopy] ?? feature.kind)}</li>`,
    )
    .join("")}</ul>

<h2>${e(copy.comparisonTitle)}</h2>
<p>${e(fillTemplate(copy.comparisonLine, { added, shade: number0.format(dossier.snapshot.analysis.shade.m2), pct: number0.format(dossier.snapshot.analysis.shade.pct) }))}</p>
<p class="meta">${e(fillTemplate(copy.scenarioLine, { slug: dossier.snapshot.scenario.slug, local: dossier.snapshot.scenario.localDatetime, engine: dossier.snapshot.analysis.engineVersion }))}</p>
${dossier.snapshot.analysis.shade.coverageIncomplete ? `<p class="meta">${e(copy.coverageNote)}</p>` : ""}

<h2>${e(copy.costTitle)}</h2>
<p class="notice">${e(copy.costLabels[cost.label])}</p>
<p><strong>${e(fillTemplate(copy.costTotal, { range: total }))}</strong></p>
${cost.partial ? `<p>${e(fillTemplate(copy.costPartial, { concepts: cost.unknownConcepts.join(", ") }))}</p>` : ""}
<table>
<thead><tr><th>${e(copy.costColumns.concept)}</th><th>${e(copy.costColumns.quantity)}</th><th>${e(copy.costColumns.unit)}</th><th>${e(copy.costColumns.low)}</th><th>${e(copy.costColumns.high)}</th><th>${e(copy.costColumns.note)}</th></tr></thead>
<tbody>${lines}</tbody>
</table>
<p class="meta">${e(fillTemplate(copy.costMeta, { date: cost.priceDate ?? "", source: cost.source ?? "", rounding: cost.rounding ?? "" }))}</p>

<h2>${e(copy.milestonesTitle)}</h2>
${milestones}

<h2>${e(copy.evidenceTitle)}</h2>
${evidence}

<h2>${e(copy.timelineTitle)}</h2>
${timeline}

<p class="meta">${e(fillTemplate(copy.supportContext, { count: dossier.supportCount }))}</p>
<p class="meta">${e(generatedAt.toISOString())}</p>
</body>
</html>
`;
}
