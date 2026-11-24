import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  addComment,
  reportTarget,
  retractComment,
  toggleSupport,
} from "@/features/community/actions";
import type { CommunityData } from "@/features/community/load-community";
import { fillTemplate } from "@/features/editor/describe";
import type { Locale } from "@/lib/i18n/locales";
import { reportReasons } from "@/lib/schemas/community";
import type esMessages from "@/messages/es.json";

type CommunityMessages = (typeof esMessages)["community"];

export type CommunityStatus = {
  code: string | null;
  wait: number | null;
};

type Props = {
  locale: Locale;
  messages: CommunityMessages;
  publicationId: string;
  data: CommunityData;
  anchors: { id: string; label: string }[];
  status: CommunityStatus;
};

function ReportForm({
  locale,
  m,
  publicationId,
  targetKind,
  targetId,
  summary,
}: {
  locale: Locale;
  m: CommunityMessages;
  publicationId: string;
  targetKind: "publication" | "comment";
  targetId: string;
  summary: string;
}) {
  const id = `report-${targetId}`;
  return (
    <details className="community-report">
      <summary>{summary}</summary>
      <form action={reportTarget} className="community-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="publicationId" value={publicationId} />
        <input type="hidden" name="targetKind" value={targetKind} />
        <input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <label htmlFor={`${id}-reason`}>{m.reportReason}</label>
        <select id={`${id}-reason`} name="reason" required>
          {reportReasons.map((reason) => (
            <option key={reason} value={reason}>
              {m.reasons[reason]}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-note`}>{m.reportNote}</label>
        <textarea id={`${id}-note`} name="note" rows={3} maxLength={500} />
        <p className="field-help">{m.reportHelp}</p>
        <button className="button button-secondary" type="submit">
          {m.reportSubmit}
        </button>
      </form>
    </details>
  );
}

export function CommunitySection({
  locale,
  messages: m,
  publicationId,
  data,
  anchors,
  status,
}: Props) {
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  });
  const signInHref = `/${locale}/auth/sign-in?returnTo=${encodeURIComponent(`/${locale}/publications/${publicationId}`)}`;

  const statusText = (() => {
    if (!status.code) return null;
    if (Object.hasOwn(m.status, status.code)) {
      return {
        tone: "success" as const,
        text: m.status[status.code as keyof typeof m.status],
      };
    }
    if (status.code === "rate_limited") {
      return {
        tone: "error" as const,
        text: fillTemplate(m.errors.rate_limited, {
          minutes: Math.max(1, Math.ceil((status.wait ?? 60) / 60)),
        }),
      };
    }
    const known = Object.hasOwn(m.errors, status.code)
      ? status.code
      : "generic";
    return {
      tone: "error" as const,
      text: m.errors[known as keyof typeof m.errors],
    };
  })();

  const supportLine =
    data.supportCount === 0
      ? m.supportZero
      : data.supportCount === 1
        ? m.supportOne
        : fillTemplate(m.supportMany, { count: data.supportCount });

  return (
    <section
      className="community"
      id="community"
      aria-labelledby="community-title"
    >
      <h2 id="community-title">{m.title}</h2>
      <p className="field-help">{m.scopeNotice}</p>

      {statusText ? (
        <p
          className={`editor-status editor-status-${statusText.tone === "error" ? "error" : "success"}`}
          role={statusText.tone === "error" ? "alert" : "status"}
        >
          {statusText.text}
        </p>
      ) : null}

      <div className="community-support">
        <p>
          <strong>{supportLine}</strong>
          {data.supported ? <> {m.supportedByYou}</> : null}
        </p>
        {data.signedIn ? (
          <form action={toggleSupport}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="publicationId" value={publicationId} />
            <input
              type="hidden"
              name="supported"
              value={data.supported ? "false" : "true"}
            />
            <button
              className="button button-secondary"
              type="submit"
              aria-pressed={data.supported}
            >
              {data.supported ? m.unsupport : m.support}
            </button>
          </form>
        ) : (
          <p className="field-help">
            {m.signInPrompt} <Link href={signInHref}>{m.signIn}</Link>
          </p>
        )}
      </div>

      {data.notices.length > 0 ? (
        <div className="community-notices">
          <h3>{m.noticesTitle}</h3>
          <ul>
            {data.notices.map((notice) => (
              <li key={notice.commentId}>
                <p className="community-body">{notice.body}</p>
                <p className="field-help">
                  <span aria-hidden="true">
                    {notice.state === "hidden" ? "▲" : "○"}
                  </span>{" "}
                  {notice.state === "hidden"
                    ? fillTemplate(m.noticeHidden, {
                        reason: notice.reason ?? "",
                      })
                    : m.noticeRetracted}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 id="comments">
        {fillTemplate(m.commentsTitle, { count: data.commentCount })}
      </h3>
      {data.comments.length === 0 ? (
        <p className="empty-message">{m.commentsEmpty}</p>
      ) : (
        <ol className="community-comments">
          {data.comments.map((comment) => (
            <li key={comment.commentId}>
              <p className="community-meta">
                <strong>{comment.authorAlias}</strong>
                {" · "}
                <time dateTime={comment.createdAt}>
                  {date.format(new Date(comment.createdAt))}
                </time>
                {comment.anchor ? (
                  <>
                    {" · "}
                    {fillTemplate(m.anchoredTo, {
                      label:
                        comment.anchor.label ??
                        comment.anchor.featureId.slice(0, 8),
                    })}
                  </>
                ) : null}
              </p>
              {/* Plain text only: React escapes it and CSS keeps the line breaks. */}
              <p className="community-body">{comment.body}</p>
              <div className="button-row">
                {data.signedIn && comment.mine ? (
                  <form action={retractComment}>
                    <input type="hidden" name="locale" value={locale} />
                    <input
                      type="hidden"
                      name="publicationId"
                      value={publicationId}
                    />
                    <input
                      type="hidden"
                      name="commentId"
                      value={comment.commentId}
                    />
                    <button className="button button-secondary" type="submit">
                      {m.retract}
                    </button>
                  </form>
                ) : null}
              </div>
              {data.signedIn && !comment.mine ? (
                <ReportForm
                  locale={locale}
                  m={m}
                  publicationId={publicationId}
                  targetKind="comment"
                  targetId={comment.commentId}
                  summary={m.reportComment}
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {data.nextCursor ? (
        <p>
          <Link
            className="button button-secondary"
            href={`/${locale}/publications/${publicationId}?commentsCursor=${encodeURIComponent(data.nextCursor)}#comments`}
          >
            {m.moreComments}
          </Link>
        </p>
      ) : null}

      {data.signedIn ? (
        <>
          <form
            action={addComment}
            className="editor-form community-form"
            aria-labelledby="comment-form-title"
          >
            <h3 id="comment-form-title">{m.commentFormTitle}</h3>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="publicationId" value={publicationId} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label htmlFor="comment-body">{m.commentLabel}</label>
            <textarea
              id="comment-body"
              name="body"
              rows={4}
              required
              maxLength={1000}
              aria-describedby="comment-help"
            />
            <p className="field-help" id="comment-help">
              {m.commentHelp}
            </p>
            <label htmlFor="comment-anchor">{m.anchorLabel}</label>
            <select id="comment-anchor" name="featureId" defaultValue="">
              <option value="">{m.anchorNone}</option>
              {anchors.map((anchor) => (
                <option key={anchor.id} value={anchor.id}>
                  {anchor.label}
                </option>
              ))}
            </select>
            <button className="button button-primary" type="submit">
              {m.commentSubmit}
            </button>
          </form>

          <ReportForm
            locale={locale}
            m={m}
            publicationId={publicationId}
            targetKind="publication"
            targetId={publicationId}
            summary={m.reportPublication}
          />
        </>
      ) : null}
    </section>
  );
}
