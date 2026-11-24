import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { fillTemplate } from "@/features/editor/describe";
import { dismissReport, moderateContent } from "@/features/moderation/actions";
import { pilotSite } from "@/features/places/site-data";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import {
  hiddenContentSchema,
  openReportsPageSchema,
  type HiddenContent,
  type OpenReport,
} from "@/lib/schemas/community";
import { createClient } from "@/lib/supabase/server";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const messages = { es, en } as const;

type ModerationPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
};

type ModerationMessages = (typeof es)["moderation"];

function DecisionForm({
  locale,
  m,
  siteId,
  targetKind,
  targetId,
  action,
  reportId,
  idPrefix,
}: {
  locale: Locale;
  m: ModerationMessages;
  siteId: string;
  targetKind: "publication" | "comment";
  targetId: string;
  action: "hide" | "restore";
  reportId: string | null;
  idPrefix: string;
}) {
  return (
    <form action={moderateContent} className="community-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="siteId" value={siteId} />
      <input type="hidden" name="targetKind" value={targetKind} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="reportId" value={reportId ?? ""} />
      <input type="hidden" name="idempotencyKey" value={randomUUID()} />
      <label htmlFor={`${idPrefix}-reason`}>{m.reasonField}</label>
      <textarea
        id={`${idPrefix}-reason`}
        name="reason"
        rows={2}
        required
        maxLength={500}
      />
      <label htmlFor={`${idPrefix}-private`}>{m.privateNoteField}</label>
      <textarea
        id={`${idPrefix}-private`}
        name="privateNote"
        rows={2}
        maxLength={500}
      />
      <button className="button button-primary" type="submit">
        {action === "hide" ? m.hide : m.restore}
      </button>
    </form>
  );
}

function TargetLine({
  locale,
  m,
  kind,
  state,
  publicationId,
}: {
  locale: Locale;
  m: ModerationMessages;
  kind: "publication" | "comment";
  state: "visible" | "hidden";
  publicationId: string;
}) {
  return (
    <p>
      <strong>
        {kind === "publication" ? m.targetPublication : m.targetComment}
      </strong>
      {" · "}
      <span className={`moderation-state moderation-state-${state}`}>
        <span aria-hidden="true">{state === "hidden" ? "▲ " : "✓ "}</span>
        {state === "hidden" ? m.stateHidden : m.stateVisible}
      </span>
      {state === "visible" ? (
        <>
          {" · "}
          <Link href={`/${locale}/publications/${publicationId}#community`}>
            {m.viewPublic}
          </Link>
        </>
      ) : null}
    </p>
  );
}

async function ModerationContent({
  params,
  searchParams,
}: ModerationPageProps) {
  await connection();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const copy = messages[locale];
  const m = copy.moderation;
  const number = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  });

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    redirect(
      `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/moderation`)}`,
    );
  }

  // site_roles is readable only for the caller's own rows (RLS).
  const { data: roles } = await supabase
    .from("site_roles")
    .select("site_id")
    .eq("role", "moderator");
  const moderates = (roles ?? []).some((row) => row.site_id === pilotSite.id);

  let reports: OpenReport[] = [];
  let hidden: HiddenContent[] = [];
  let loadFailed = false;
  if (moderates) {
    const [queue, hiddenResult] = await Promise.all([
      supabase.rpc("list_open_reports", {
        p_site_id: pilotSite.id,
        p_limit: 50,
      }),
      supabase.rpc("list_hidden_content", {
        p_site_id: pilotSite.id,
        p_limit: 50,
      }),
    ]);
    const parsedQueue = openReportsPageSchema.safeParse(queue.data);
    const parsedHidden = hiddenContentSchema.safeParse(hiddenResult.data);
    if (
      queue.error ||
      hiddenResult.error ||
      !parsedQueue.success ||
      !parsedHidden.success
    ) {
      loadFailed = true;
    } else {
      reports = parsedQueue.data.items;
      hidden = parsedHidden.data.items;
    }
  }

  const statusText =
    query.status && Object.hasOwn(m.status, query.status)
      ? m.status[query.status as keyof typeof m.status]
      : null;
  const errorText = query.error
    ? m.errors[
        (Object.hasOwn(m.errors, query.error)
          ? query.error
          : "generic") as keyof typeof m.errors
      ]
    : null;

  return (
    <>
      <a className="skip-link" href="#moderation-main">
        {copy.nav.skip}
      </a>
      <header className="branches-header">
        <Link className="brand" href={`/${locale}`}>
          <span aria-hidden="true">←</span> {m.back}
        </Link>
      </header>
      <main className="moderation-page" id="moderation-main">
        <h1>{m.title}</h1>

        {statusText ? (
          <p className="editor-status editor-status-success" role="status">
            {statusText}
          </p>
        ) : null}
        {errorText ? (
          <p className="editor-status editor-status-error" role="alert">
            {errorText}
          </p>
        ) : null}

        {!moderates ? (
          <p className="editor-status editor-status-info" role="status">
            {m.noRole}
          </p>
        ) : loadFailed ? (
          <div className="editor-status editor-status-error" role="alert">
            <p>{m.loadError}</p>
            <Link
              className="button button-secondary"
              href={`/${locale}/moderation`}
            >
              {m.retry}
            </Link>
          </div>
        ) : (
          <>
            <p className="eyebrow">
              {fillTemplate(m.siteHeading, { name: pilotSite.name[locale] })}
            </p>

            <section aria-labelledby="queue-title">
              <h2 id="queue-title">
                {m.queueTitle} ({reports.length})
              </h2>
              {reports.length === 0 ? (
                <p className="empty-message">{m.queueEmpty}</p>
              ) : (
                <ol className="moderation-list">
                  {reports.map((report) => (
                    <li key={report.reportId} className="moderation-card">
                      <TargetLine
                        locale={locale}
                        m={m}
                        kind={report.targetKind}
                        state={report.targetState}
                        publicationId={report.publicationId}
                      />
                      {report.preview ? (
                        <p className="community-body">{report.preview}</p>
                      ) : null}
                      <p>
                        {fillTemplate(m.reportedBy, {
                          alias: report.reporterAlias,
                          date: number.format(new Date(report.createdAt)),
                        })}
                      </p>
                      <p>
                        {fillTemplate(m.reasonLine, {
                          reason: copy.community.reasons[report.reason],
                        })}
                      </p>
                      {report.note ? (
                        <p className="community-body">
                          {fillTemplate(m.noteLine, { note: report.note })}
                        </p>
                      ) : null}
                      <h3>{m.decisionTitle}</h3>
                      <DecisionForm
                        locale={locale}
                        m={m}
                        siteId={pilotSite.id}
                        targetKind={report.targetKind}
                        targetId={report.commentId ?? report.publicationId}
                        action={
                          report.targetState === "hidden" ? "restore" : "hide"
                        }
                        reportId={report.reportId}
                        idPrefix={`decision-${report.reportId}`}
                      />
                      <form action={dismissReport} className="community-form">
                        <input type="hidden" name="locale" value={locale} />
                        <input
                          type="hidden"
                          name="reportId"
                          value={report.reportId}
                        />
                        <input
                          type="hidden"
                          name="idempotencyKey"
                          value={randomUUID()}
                        />
                        <label htmlFor={`dismiss-${report.reportId}`}>
                          {m.dismissNote}
                        </label>
                        <textarea
                          id={`dismiss-${report.reportId}`}
                          name="note"
                          rows={2}
                          required
                          maxLength={500}
                        />
                        <button
                          className="button button-secondary"
                          type="submit"
                        >
                          {m.dismiss}
                        </button>
                      </form>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="hidden-title">
              <h2 id="hidden-title">
                {m.hiddenTitle} ({hidden.length})
              </h2>
              {hidden.length === 0 ? (
                <p className="empty-message">{m.hiddenEmpty}</p>
              ) : (
                <ol className="moderation-list">
                  {hidden.map((item) => (
                    <li key={item.targetId} className="moderation-card">
                      <TargetLine
                        locale={locale}
                        m={m}
                        kind={item.targetKind}
                        state="hidden"
                        publicationId={item.publicationId}
                      />
                      {item.preview ? (
                        <p className="community-body">{item.preview}</p>
                      ) : null}
                      <p>
                        {fillTemplate(m.hiddenReason, { reason: item.reason })}
                      </p>
                      <DecisionForm
                        locale={locale}
                        m={m}
                        siteId={pilotSite.id}
                        targetKind={item.targetKind}
                        targetId={item.targetId}
                        action="restore"
                        reportId={null}
                        idPrefix={`restore-${item.targetId}`}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

export default function ModerationPage(props: ModerationPageProps) {
  return (
    <Suspense fallback={<main className="moderation-page" aria-busy="true" />}>
      <ModerationContent {...props} />
    </Suspense>
  );
}
