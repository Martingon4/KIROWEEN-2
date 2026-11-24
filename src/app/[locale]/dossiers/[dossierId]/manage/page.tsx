import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  addEvidenceAction,
  addMilestoneAction,
  revertAction,
  saveResponsible,
  transitionAction,
  updateMilestoneAction,
  verifyEvidenceAction,
} from "@/features/dossier/actions";
import { STATUS_SYMBOL } from "@/features/dossier/dossier-view";
import { fillTemplate } from "@/features/editor/describe";
import { pilotSite } from "@/features/places/site-data";
import { isLocale } from "@/lib/i18n/locales";
import {
  managedDossierSchema,
  type DossierStatus,
} from "@/lib/schemas/dossier";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type ManagePageProps = {
  params: Promise<{ locale: string; dossierId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

const NEXT_STATES: Record<DossierStatus, DossierStatus[]> = {
  en_revision: ["planeado", "descartado"],
  planeado: ["en_ejecucion", "descartado"],
  en_ejecucion: ["ejecutado", "descartado"],
  ejecutado: [],
  descartado: [],
};

function Hidden({
  locale,
  dossierId,
  key = true,
}: {
  locale: string;
  dossierId: string;
  key?: boolean;
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="dossierId" value={dossierId} />
      {key ? (
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
      ) : null}
    </>
  );
}

async function ManageContent({ params, searchParams }: ManagePageProps) {
  await connection();
  const { locale, dossierId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const copy = messages[locale];
  const d = copy.dossier;

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/dossiers/${dossierId}/manage`)}`,
    );
  }

  const { data, error } = await supabase.rpc("get_managed_dossier", {
    p_dossier_id: dossierId,
  });
  if (error) {
    // Not a coordinator of the site, or no such dossier: the same plain 404.
    if (error.code === "P0002") notFound();
    throw new Error("The dossier could not be loaded.");
  }
  const parsed = managedDossierSchema.safeParse(data);
  if (!parsed.success) throw new Error("The dossier response was not valid.");
  const dossier = parsed.data;
  if (dossier.siteId !== pilotSite.id) notFound();

  const hidden = dossier.moderationState === "hidden";
  const closed =
    dossier.status === "ejecutado" || dossier.status === "descartado";
  const canWrite = !hidden && !closed;
  const nextStates = NEXT_STATES[dossier.status];
  const hasStatusChange = dossier.events.some(
    (event) => event.kind === "status_change",
  );
  const dateOnly = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  });

  const savedText =
    query.saved && Object.hasOwn(d.saved, query.saved)
      ? d.saved[query.saved as keyof typeof d.saved]
      : null;
  const errorText = query.error
    ? d.errors[
        (Object.hasOwn(d.errors, query.error)
          ? query.error
          : "generic") as keyof typeof d.errors
      ]
    : null;

  return (
    <>
      <a className="skip-link" href="#manage-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}/dossiers/${dossierId}`}>
          <span aria-hidden="true">←</span> {d.openDossier}
        </Link>
      </header>
      <main className="publication-page dossier-page" id="manage-main">
        <p className="eyebrow">{pilotSite.name[locale]}</p>
        <h1>{d.manageTitle}</h1>
        <p>
          <strong>{dossier.label}</strong>
          {" · "}
          <span className={`dossier-status dossier-status-${dossier.status}`}>
            <span aria-hidden="true">{STATUS_SYMBOL[dossier.status]}</span>{" "}
            {fillTemplate(d.statusLine, { status: d.status[dossier.status] })}
          </span>
        </p>

        {savedText ? (
          <p className="editor-status editor-status-success" role="status">
            {savedText}
          </p>
        ) : null}
        {errorText ? (
          <p className="editor-status editor-status-error" role="alert">
            {errorText}
          </p>
        ) : null}
        {hidden ? (
          <p className="editor-status editor-status-info">{d.manageHidden}</p>
        ) : null}
        {closed && !hidden ? (
          <p className="editor-status editor-status-info">{d.manageClosed}</p>
        ) : null}

        <section
          aria-labelledby="manage-responsible-title"
          className="editor-form"
        >
          <h2 id="manage-responsible-title">{d.responsibleTitle}</h2>
          <p>{dossier.responsibleName ?? d.responsibleNone}</p>
          {canWrite ? (
            <form action={saveResponsible} className="community-form">
              <Hidden locale={locale} dossierId={dossierId} />
              <label htmlFor="responsible-name">{d.responsibleName}</label>
              <input
                id="responsible-name"
                name="responsibleName"
                maxLength={100}
              />
              <div className="consent-field">
                <input
                  id="responsible-authorized"
                  name="responsibleAuthorized"
                  type="checkbox"
                />
                <label htmlFor="responsible-authorized">
                  {d.responsibleAuthorized}
                </label>
              </div>
              <p className="field-help">{d.responsibleHelp}</p>
              <div className="button-row">
                <button className="button button-primary" type="submit">
                  {d.responsibleSave}
                </button>
                {dossier.responsibleName ? (
                  <button
                    className="button button-secondary"
                    type="submit"
                    name="intent"
                    value="remove"
                  >
                    {d.responsibleRemove}
                  </button>
                ) : null}
              </div>
            </form>
          ) : dossier.responsibleName ? (
            // Withdrawing a name stays possible when the dossier is closed or hidden.
            <form action={saveResponsible} className="community-form">
              <Hidden locale={locale} dossierId={dossierId} />
              <button
                className="button button-secondary"
                type="submit"
                name="intent"
                value="remove"
              >
                {d.responsibleRemove}
              </button>
            </form>
          ) : null}
        </section>

        <section
          aria-labelledby="manage-milestones-title"
          className="editor-form"
        >
          <h2 id="manage-milestones-title">{d.milestonesTitle}</h2>
          {dossier.milestones.length === 0 ? (
            <p className="empty-message">{d.milestonesEmpty}</p>
          ) : (
            <ul className="publication-features">
              {dossier.milestones.map((milestone) => (
                <li key={milestone.id}>
                  <strong>
                    {fillTemplate(d.milestoneLine, {
                      title: milestone.title,
                      date: dateOnly(milestone.targetDate),
                    })}
                  </strong>
                  <span>{d.milestoneStatus[milestone.status]}</span>
                  {canWrite && milestone.status !== "cancelado" ? (
                    <form action={updateMilestoneAction} className="button-row">
                      <Hidden locale={locale} dossierId={dossierId} />
                      <input
                        type="hidden"
                        name="milestoneId"
                        value={milestone.id}
                      />
                      <input
                        type="hidden"
                        name="expectedStatus"
                        value={milestone.status}
                      />
                      <input
                        type="hidden"
                        name="title"
                        value={milestone.title}
                      />
                      <input
                        type="hidden"
                        name="targetDate"
                        value={milestone.targetDate}
                      />
                      {(milestone.status === "pendiente"
                        ? (["cumplido", "cancelado"] as const)
                        : (["pendiente"] as const)
                      ).map((status) => (
                        <button
                          key={status}
                          className="button button-secondary"
                          type="submit"
                          name="status"
                          value={status}
                        >
                          {fillTemplate(d.milestoneMark, {
                            status: d.milestoneStatus[status],
                          })}
                        </button>
                      ))}
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <form action={addMilestoneAction} className="community-form">
              <h3>{d.milestoneFormTitle}</h3>
              <Hidden locale={locale} dossierId={dossierId} />
              <label htmlFor="milestone-title">{d.milestoneTitleLabel}</label>
              <input
                id="milestone-title"
                name="title"
                required
                maxLength={100}
              />
              <label htmlFor="milestone-date">{d.milestoneDateLabel}</label>
              <input
                id="milestone-date"
                name="targetDate"
                type="date"
                required
              />
              <button className="button button-primary" type="submit">
                {d.milestoneAdd}
              </button>
            </form>
          ) : null}
        </section>

        <section
          aria-labelledby="manage-evidence-title"
          className="editor-form"
        >
          <h2 id="manage-evidence-title">{d.evidenceTitle}</h2>
          {dossier.evidence.length === 0 ? (
            <p className="empty-message">{d.evidenceEmpty}</p>
          ) : (
            <ul className="publication-features">
              {dossier.evidence.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span className="community-body">{item.description}</span>
                  <span>
                    {fillTemplate(d.evidenceRecordedBy, {
                      alias: item.recordedByAlias,
                      date: dateOnly(item.evidenceDate),
                    })}
                  </span>
                  <span>
                    {fillTemplate(d.evidenceDomain, { host: item.host })}
                    {" · "}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {d.evidenceOpen}
                    </a>
                  </span>
                  <span>
                    <span aria-hidden="true">
                      {item.verifiedByTeam ? "✓ " : "○ "}
                    </span>
                    {item.verifiedByTeam
                      ? fillTemplate(d.evidenceVerified, {
                          alias: item.verifiedByAlias ?? "",
                        })
                      : d.evidenceUnverified}
                  </span>
                  {!hidden ? (
                    <form action={verifyEvidenceAction}>
                      <Hidden locale={locale} dossierId={dossierId} />
                      <input type="hidden" name="evidenceId" value={item.id} />
                      <input
                        type="hidden"
                        name="verified"
                        value={item.verifiedByTeam ? "false" : "true"}
                      />
                      <button className="button button-secondary" type="submit">
                        {item.verifiedByTeam
                          ? d.evidenceUnverify
                          : d.evidenceVerify}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <form action={addEvidenceAction} className="community-form">
              <h3>{d.evidenceFormTitle}</h3>
              <Hidden locale={locale} dossierId={dossierId} />
              <label htmlFor="evidence-url">{d.evidenceUrlLabel}</label>
              <input
                id="evidence-url"
                name="url"
                type="url"
                required
                maxLength={2048}
                aria-describedby="evidence-url-help"
              />
              <p className="field-help" id="evidence-url-help">
                {d.evidenceUrlHelp}
              </p>
              <label htmlFor="evidence-title">{d.evidenceTitleLabel}</label>
              <input
                id="evidence-title"
                name="title"
                required
                maxLength={100}
              />
              <label htmlFor="evidence-description">
                {d.evidenceDescriptionLabel}
              </label>
              <textarea
                id="evidence-description"
                name="description"
                rows={3}
                required
                maxLength={1000}
              />
              <label htmlFor="evidence-date">{d.evidenceDateLabel}</label>
              <input
                id="evidence-date"
                name="evidenceDate"
                type="date"
                required
              />
              <button className="button button-primary" type="submit">
                {d.evidenceAdd}
              </button>
            </form>
          ) : null}
        </section>

        {canWrite && nextStates.length > 0 ? (
          <form
            action={transitionAction}
            className="editor-form community-form"
            aria-labelledby="manage-transition-title"
          >
            <h2 id="manage-transition-title">{d.transitionTitle}</h2>
            <p className="field-help">{d.transitionRules}</p>
            <Hidden locale={locale} dossierId={dossierId} />
            <input type="hidden" name="expectedState" value={dossier.status} />
            <label htmlFor="transition-new">{d.transitionNew}</label>
            <select id="transition-new" name="newState" required>
              {nextStates.map((state) => (
                <option key={state} value={state}>
                  {d.status[state]}
                </option>
              ))}
            </select>
            <label htmlFor="transition-note">{d.transitionNote}</label>
            <textarea
              id="transition-note"
              name="note"
              rows={3}
              maxLength={1000}
            />
            <label htmlFor="transition-observation">
              {d.transitionObservation}
            </label>
            <textarea
              id="transition-observation"
              name="observation"
              rows={3}
              maxLength={1000}
            />
            <label htmlFor="transition-difference">
              {d.transitionDifference}
            </label>
            <textarea
              id="transition-difference"
              name="difference"
              rows={3}
              maxLength={1000}
            />
            <fieldset className="dossier-evidence-choice">
              <legend>{d.transitionEvidence}</legend>
              {dossier.evidence.length === 0 ? (
                <p className="field-help">{d.noEvidenceYet}</p>
              ) : (
                dossier.evidence.map((item) => (
                  <label className="merge-option" key={item.id}>
                    <input type="checkbox" name="evidenceIds" value={item.id} />
                    <span>{item.title}</span>
                  </label>
                ))
              )}
            </fieldset>
            <button className="button button-primary" type="submit">
              {d.transitionSubmit}
            </button>
          </form>
        ) : null}

        {!hidden && hasStatusChange ? (
          <form
            action={revertAction}
            className="editor-form community-form"
            aria-labelledby="manage-revert-title"
          >
            <h2 id="manage-revert-title">{d.revertTitle}</h2>
            <p className="field-help">{d.revertBody}</p>
            <Hidden locale={locale} dossierId={dossierId} />
            <input type="hidden" name="expectedState" value={dossier.status} />
            <label htmlFor="revert-note">{d.revertNote}</label>
            <textarea
              id="revert-note"
              name="note"
              rows={2}
              required
              maxLength={1000}
            />
            <button className="button button-secondary" type="submit">
              {d.revertSubmit}
            </button>
          </form>
        ) : null}

        <section aria-labelledby="manage-timeline-title">
          <h2 id="manage-timeline-title">{d.timelineTitle}</h2>
          <ol className="dossier-timeline">
            {dossier.events.map((event) => (
              <li key={event.seq}>
                <p>
                  <strong>{d.eventKinds[event.kind]}</strong>
                  {event.newState ? ` — ${d.status[event.newState]}` : ""}
                </p>
                <p className="field-help">
                  {fillTemplate(d.eventLine, {
                    date: dateTime.format(new Date(event.createdAt)),
                    actor: event.actorAlias,
                  })}
                </p>
                {event.note ? (
                  <p className="community-body">{event.note}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}

export default function ManagePage(props: ManagePageProps) {
  return (
    <Suspense fallback={<main className="publication-page" aria-busy="true" />}>
      <ManageContent {...props} />
    </Suspense>
  );
}
