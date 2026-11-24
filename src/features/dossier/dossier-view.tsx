import Link from "next/link";
import { fillTemplate } from "@/features/editor/describe";
import { RevisionPreview } from "@/features/versions/revision-preview";
import { formatCentsRange } from "@/lib/format/money";
import type { BoundingBox, DrawableGeometry } from "@/lib/geo/project";
import type { Locale } from "@/lib/i18n/locales";
import type { DossierStatus, PublicDossier } from "@/lib/schemas/dossier";
import type esMessages from "@/messages/es.json";

type DossierCopy = (typeof esMessages)["dossier"];
type KindCopy = (typeof esMessages)["editor"]["kinds"];

export const STATUS_SYMBOL: Record<DossierStatus, string> = {
  en_revision: "◔",
  planeado: "◑",
  en_ejecucion: "◕",
  ejecutado: "●",
  descartado: "✕",
};

type Props = {
  dossier: PublicDossier;
  locale: Locale;
  copy: DossierCopy;
  kinds: KindCopy;
  siteName: string;
  boundary: DrawableGeometry;
  bounds: BoundingBox;
  canManage: boolean;
};

const EXPORTS = ["html", "geojson", "csv", "json"] as const;

export function DossierView({
  dossier,
  locale,
  copy,
  kinds,
  siteName,
  boundary,
  bounds,
  canManage,
}: Props) {
  const timeZone = dossier.snapshot.scenario.timezone;
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const dateOnly = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const cost = dossier.snapshot.cost;
  const currency = cost.currency ?? "MXN";
  const evidenceById = new Map(dossier.evidence.map((item) => [item.id, item]));

  return (
    <main className="publication-page dossier-page" id="dossier-main">
      <p className="eyebrow">
        {siteName} · {copy.eyebrow}
      </p>
      <h1>{dossier.publication.label}</h1>
      <p className="dossier-status-line">
        <span className={`dossier-status dossier-status-${dossier.status}`}>
          <span aria-hidden="true">{STATUS_SYMBOL[dossier.status]}</span>{" "}
          {fillTemplate(copy.statusLine, {
            status: copy.status[dossier.status],
          })}
        </span>
      </p>
      <ul className="publication-notices">
        <li>{copy.hypothetical}</li>
      </ul>

      <section aria-labelledby="dossier-decision-title">
        <h2 id="dossier-decision-title">{copy.decisionTitle}</h2>
        <p className="publication-summary">{dossier.decisionNote}</p>
        <dl className="dossier-facts">
          <div>
            <dt>{copy.responsibleLabel}</dt>
            <dd>{dossier.responsibleName ?? copy.responsibleNone}</dd>
          </div>
          <div>
            <dt>{copy.targetLabel}</dt>
            <dd>
              {dossier.targetDate
                ? dateOnly(dossier.targetDate)
                : copy.targetNone}
            </dd>
          </div>
        </dl>
        {canManage ? (
          <p>
            <Link
              className="button button-secondary"
              href={`/${locale}/dossiers/${dossier.dossierId}/manage`}
            >
              {copy.manageLink}
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="dossier-proposal-title">
        <h2 id="dossier-proposal-title">{copy.proposalTitle}</h2>
        <p className="publication-summary">{dossier.publication.summary}</p>
        <p className="field-help">{copy.proposalNote}</p>
        <p className="field-help">
          {fillTemplate(copy.authorLine, {
            date: dateTime.format(new Date(dossier.publication.publishedAt)),
            alias: dossier.publication.authorAlias,
          })}{" "}
          <Link href={`/${locale}/publications/${dossier.publicationId}`}>
            {copy.backToPublication}
          </Link>
        </p>
        <div className="publication-preview">
          <RevisionPreview
            ariaLabel={copy.proposalPreviewAria}
            boundary={boundary}
            bounds={bounds}
            features={dossier.publication.features}
          />
        </div>
        <ul className="publication-features">
          {dossier.publication.features.map((feature) => (
            <li key={feature.id}>
              <strong>{feature.properties.label}</strong>
              <span>{kinds[feature.kind]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dossier-comparison-title">
        <h2 id="dossier-comparison-title">{copy.comparisonTitle}</h2>
        <p>
          {fillTemplate(copy.comparisonLine, {
            added: dossier.comparison.counts.added,
            shade: number.format(dossier.snapshot.analysis.shade.m2),
            pct: number.format(dossier.snapshot.analysis.shade.pct),
          })}
        </p>
        <p className="field-help">
          {fillTemplate(copy.scenarioLine, {
            slug: dossier.snapshot.scenario.slug,
            local: dossier.snapshot.scenario.localDatetime,
            engine: dossier.snapshot.analysis.engineVersion,
          })}
        </p>
        {dossier.snapshot.analysis.shade.coverageIncomplete ? (
          <p className="field-help">{copy.coverageNote}</p>
        ) : null}
      </section>

      <section aria-labelledby="dossier-cost-title">
        <h2 id="dossier-cost-title">{copy.costTitle}</h2>
        <p className="publication-notices-inline">
          {copy.costLabels[cost.label]}
        </p>
        <p>
          <strong>
            {fillTemplate(copy.costTotal, {
              range: formatCentsRange(
                cost.totalLowCents,
                cost.totalHighCents,
                currency,
                locale,
              ),
            })}
          </strong>
        </p>
        {cost.partial ? (
          <p className="field-help">
            {fillTemplate(copy.costPartial, {
              concepts: cost.unknownConcepts.join(", "),
            })}
          </p>
        ) : null}
        <div
          className="compare-table-wrap"
          role="region"
          aria-labelledby="dossier-cost-title"
          tabIndex={0}
        >
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">{copy.costColumns.concept}</th>
                <th scope="col">{copy.costColumns.quantity}</th>
                <th scope="col">{copy.costColumns.unit}</th>
                <th scope="col">{copy.costColumns.low}</th>
                <th scope="col">{copy.costColumns.high}</th>
                <th scope="col">{copy.costColumns.note}</th>
              </tr>
            </thead>
            <tbody>
              {cost.lines.map((line) => (
                <tr key={line.concept}>
                  <th scope="row">
                    {kinds[line.concept as keyof KindCopy] ?? line.concept}
                  </th>
                  <td>{number.format(line.quantity)}</td>
                  <td>{line.unit}</td>
                  <td>
                    {line.amountLowCents === null
                      ? copy.unpriced
                      : formatCentsRange(
                          line.amountLowCents,
                          line.amountLowCents,
                          currency,
                          locale,
                        )}
                  </td>
                  <td>
                    {line.amountHighCents === null
                      ? copy.unpriced
                      : formatCentsRange(
                          line.amountHighCents,
                          line.amountHighCents,
                          currency,
                          locale,
                        )}
                  </td>
                  <td>
                    {line.isAssumption
                      ? fillTemplate(copy.assumptionTag, {
                          owner: line.assumptionOwner ?? "",
                          date: line.assumptionDate ?? "",
                        })
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-help">
          {fillTemplate(copy.costMeta, {
            date: cost.priceDate ?? "",
            source: cost.source ?? "",
            rounding: cost.rounding ?? "",
          })}
        </p>
      </section>

      <section aria-labelledby="dossier-milestones-title">
        <h2 id="dossier-milestones-title">{copy.milestonesTitle}</h2>
        {dossier.milestones.length === 0 ? (
          <p className="empty-message">{copy.milestonesEmpty}</p>
        ) : (
          <ul className="publication-features">
            {dossier.milestones.map((milestone) => (
              <li key={milestone.id}>
                <strong>
                  {fillTemplate(copy.milestoneLine, {
                    title: milestone.title,
                    date: dateOnly(milestone.targetDate),
                  })}
                </strong>
                <span>{copy.milestoneStatus[milestone.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dossier-evidence-title">
        <h2 id="dossier-evidence-title">{copy.evidenceTitle}</h2>
        {dossier.evidence.length === 0 ? (
          <p className="empty-message">{copy.evidenceEmpty}</p>
        ) : (
          <ul className="publication-features">
            {dossier.evidence.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span className="community-body">{item.description}</span>
                <span>
                  {fillTemplate(copy.evidenceRecordedBy, {
                    alias: item.recordedByAlias,
                    date: dateOnly(item.evidenceDate),
                  })}
                </span>
                <span>
                  <span aria-hidden="true">
                    {item.verifiedByTeam ? "✓ " : "○ "}
                  </span>
                  {item.verifiedByTeam
                    ? fillTemplate(copy.evidenceVerified, {
                        alias: item.verifiedByAlias ?? "",
                      })
                    : copy.evidenceUnverified}
                </span>
                <span>
                  {fillTemplate(copy.evidenceDomain, { host: item.host })}
                  {" · "}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {copy.evidenceOpen}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dossier-timeline-title">
        <h2 id="dossier-timeline-title">{copy.timelineTitle}</h2>
        <ol className="dossier-timeline">
          {dossier.events.map((event) => (
            <li key={event.seq}>
              <p>
                <strong>{copy.eventKinds[event.kind]}</strong>
                {event.newState ? (
                  <>
                    {" — "}
                    <span aria-hidden="true">
                      {STATUS_SYMBOL[event.newState]}{" "}
                    </span>
                    {fillTemplate(copy.stateChange, {
                      from: event.previousState
                        ? copy.status[event.previousState]
                        : "—",
                      to: copy.status[event.newState],
                    })}
                  </>
                ) : null}
              </p>
              <p className="field-help">
                {fillTemplate(copy.eventLine, {
                  date: dateTime.format(new Date(event.createdAt)),
                  actor: event.actorAlias,
                })}
              </p>
              {event.note ? (
                <p className="community-body">{event.note}</p>
              ) : null}
              {event.observation ? (
                <p className="community-body">
                  <strong>{copy.observationLabel}:</strong> {event.observation}
                </p>
              ) : null}
              {event.difference ? (
                <p className="community-body">
                  <strong>{copy.differenceLabel}:</strong> {event.difference}
                </p>
              ) : null}
              {event.correctsSeq !== null ? (
                <p className="field-help">
                  {fillTemplate(copy.correctsLabel, { seq: event.correctsSeq })}
                </p>
              ) : null}
              {event.evidenceIds.length > 0 ? (
                <p className="field-help">
                  {event.evidenceIds
                    .map((id) => evidenceById.get(id)?.title)
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <p className="field-help">
        {fillTemplate(copy.supportContext, { count: dossier.supportCount })}
      </p>

      <section aria-labelledby="dossier-downloads-title">
        <h2 id="dossier-downloads-title">{copy.downloadsTitle}</h2>
        <ul className="dossier-downloads">
          {EXPORTS.map((format) => (
            <li key={format}>
              <a
                className="button button-secondary"
                href={`/api/v1/dossiers/${dossier.dossierId}/export?format=${format}&locale=${locale}`}
                {...(format === "html"
                  ? { target: "_blank", rel: "noopener" }
                  : { download: "" })}
              >
                {copy.downloads[format]}
              </a>
            </li>
          ))}
        </ul>
        <p className="field-help">{copy.downloadsNote}</p>
      </section>
    </main>
  );
}
