"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { fillTemplate } from "@/features/editor/describe";
import {
  formatCoordinates,
  parseCoordinates,
} from "@/features/editor/coordinates";
import { RevisionPreview } from "@/features/versions/revision-preview";
import { canonicalJson } from "@/lib/geo/canonical";
import type { BoundingBox, DrawableGeometry } from "@/lib/geo/project";
import type { Locale } from "@/lib/i18n/locales";
import {
  interventionSchema,
  type Intervention,
  type InterventionGeometry,
} from "@/lib/schemas/intervention";
import {
  mergeCommitResponseSchema,
  mergePreviewSchema,
  type MergeConflict,
  type MergePreview,
  type MergeResolution,
  type SpatialConflict,
} from "@/lib/schemas/merge";
import type esMessages from "@/messages/es.json";

type MergeMessages = (typeof esMessages)["merge"];
type KindMessages = (typeof esMessages)["editor"]["kinds"];

export type MergeWorkbenchProps = {
  locale: Locale;
  messages: MergeMessages;
  kinds: KindMessages;
  branchId: string;
  branchTitle: string;
  initialPreview: MergePreview;
  bounds: BoundingBox;
  boundary: DrawableGeometry;
};

/** One UI choice per conflict; redraw text stays editable until checked. */
type Choice =
  | { action: "keep_target" }
  | { action: "keep_source" }
  | { action: "remove"; featureId?: string }
  | { action: "redraw"; featureId: string; text: string };

type Status = {
  tone: "success" | "error" | "info";
  text: string;
  action?: "reload" | "open";
};

const isSpatial = (conflict: MergeConflict): conflict is SpatialConflict =>
  conflict.type === "exclusive_overlap";

export function MergeWorkbench({
  locale,
  messages: m,
  kinds,
  branchId,
  branchTitle,
  initialPreview,
  bounds,
  boundary,
}: MergeWorkbenchProps) {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const [preview, setPreview] = useState(initialPreview);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [redrawErrors, setRedrawErrors] = useState<Record<string, boolean>>({});
  // With nothing to resolve, the empty decision set is already checked.
  const [checkedSignature, setCheckedSignature] = useState<string | null>(
    initialPreview.unresolved.length === 0 &&
      initialPreview.invalidResolutions.length === 0
      ? canonicalJson([])
      : null,
  );
  const [message, setMessage] = useState(
    fillTemplate(m.messageDefault, {
      source: initialPreview.source.label,
    }).slice(0, 100),
  );
  const [busy, setBusy] = useState<"check" | "commit" | null>(null);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const pendingCommit = useRef<{ signature: string; key: string } | null>(null);

  const featureById = (id: string) =>
    preview.features.find((feature) => feature.id === id);
  const labelOf = (
    id: string,
    fallback?: { properties?: Record<string, unknown> } | null,
  ) => {
    const props = featureById(id)?.properties ?? fallback?.properties;
    return typeof props?.label === "string" ? props.label : id.slice(0, 8);
  };

  /** Builds resolutions from choices; returns null when a redraw cannot be parsed. */
  function buildResolutions(): MergeResolution[] | null {
    const errors: Record<string, boolean> = {};
    const resolutions: MergeResolution[] = [];
    for (const conflict of preview.conflicts) {
      const choice = choices[conflict.id];
      if (!choice) continue;
      if (choice.action === "keep_target" || choice.action === "keep_source") {
        resolutions.push({ conflictId: conflict.id, action: choice.action });
      } else if (choice.action === "remove") {
        resolutions.push(
          choice.featureId
            ? {
                conflictId: conflict.id,
                action: "remove",
                featureId: choice.featureId,
              }
            : { conflictId: conflict.id, action: "remove" },
        );
      } else {
        const base = featureById(choice.featureId);
        if (!base) {
          errors[conflict.id] = true;
          continue;
        }
        const parsed = parseCoordinates(choice.text, base.geometry.type);
        const candidate = parsed.ok
          ? interventionSchema.safeParse({
              id: base.id,
              kind: base.kind,
              properties: base.properties,
              geometry: parsed.geometry,
            })
          : null;
        if (!candidate?.success) {
          errors[conflict.id] = true;
          continue;
        }
        resolutions.push({
          conflictId: conflict.id,
          action: "redraw",
          feature: candidate.data as Intervention,
        });
      }
    }
    setRedrawErrors(errors);
    return Object.keys(errors).length > 0 ? null : resolutions;
  }

  async function post(path: string, body: unknown, key: string) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json().catch(() => null);
    return { response, json };
  }

  function errorText(code: string | undefined) {
    if (code && code in m.errors)
      return m.errors[code as keyof MergeMessages["errors"]];
    return m.errors.generic;
  }

  async function checkDecisions() {
    const resolutions = buildResolutions();
    if (!resolutions) {
      setStatus({ tone: "error", text: m.redrawInvalid });
      return;
    }
    setBusy("check");
    setStatus(null);
    try {
      const { response, json } = await post(
        `/api/v1/branches/${branchId}/merge/preview`,
        { sourcePublicationId: preview.source.publicationId, resolutions },
        crypto.randomUUID(),
      );
      if (response.ok) {
        const next = mergePreviewSchema.parse((json as { data: unknown }).data);
        setPreview(next);
        setCheckedSignature(canonicalJson(resolutions));
        setStatus({
          tone: next.invalidResolutions.length > 0 ? "error" : "info",
          text:
            next.invalidResolutions.length > 0
              ? m.invalidResolution
              : m.checked,
        });
      } else {
        const code = (json as { code?: string } | null)?.code;
        setStatus({
          tone: "error",
          text:
            code === "publication_not_found"
              ? m.publicationUnavailable
              : errorText(code),
        });
      }
    } catch {
      setStatus({ tone: "error", text: m.network });
    } finally {
      setBusy(null);
    }
  }

  async function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resolutions = buildResolutions();
    if (!resolutions) {
      setStatus({ tone: "error", text: m.redrawInvalid });
      return;
    }
    const signature = canonicalJson(resolutions);
    if (
      signature !== checkedSignature ||
      preview.unresolved.length > 0 ||
      preview.invalidResolutions.length > 0
    ) {
      setStatus({ tone: "error", text: m.commitBlocked });
      return;
    }
    const payload = {
      sourcePublicationId: preview.source.publicationId,
      expectedHeadId: preview.headRevisionId,
      message: message.trim(),
      resolutions,
    };
    const payloadSignature = canonicalJson(payload);
    // A retried identical commit reuses its key, so a lost response cannot merge twice.
    if (pendingCommit.current?.signature !== payloadSignature) {
      pendingCommit.current = {
        signature: payloadSignature,
        key: crypto.randomUUID(),
      };
    }
    setBusy("commit");
    setStatus(null);
    try {
      const { response, json } = await post(
        `/api/v1/branches/${branchId}/merge/commit`,
        payload,
        pendingCommit.current.key,
      );
      pendingCommit.current = null;
      if (response.status === 201) {
        mergeCommitResponseSchema.parse(json);
        setDone(true);
        setStatus({ tone: "success", text: m.committed, action: "open" });
        return;
      }
      const code = (json as { code?: string } | null)?.code;
      if (code === "stale_head") {
        setStatus({ tone: "error", text: m.staleHead, action: "reload" });
      } else if (code === "publication_not_found") {
        setStatus({ tone: "error", text: m.publicationUnavailable });
      } else if (code === "unresolved_conflicts") {
        setStatus({ tone: "error", text: m.commitBlocked });
      } else if (code === "invalid_resolution") {
        setStatus({ tone: "error", text: m.invalidResolution });
      } else {
        setStatus({ tone: "error", text: errorText(code) });
      }
    } catch {
      setStatus({ tone: "error", text: m.network });
    } finally {
      setBusy(null);
    }
  }

  function setChoice(conflictId: string, choice: Choice) {
    setChoices((current) => ({ ...current, [conflictId]: choice }));
    setCheckedSignature(null);
  }

  const decisionCounts = preview.operations.reduce<Record<string, number>>(
    (counts, operation) => ({
      ...counts,
      [operation.decision]: (counts[operation.decision] ?? 0) + 1,
    }),
    {},
  );
  const ready =
    checkedSignature !== null &&
    preview.unresolved.length === 0 &&
    preview.invalidResolutions.length === 0 &&
    !preview.tooManyFeatures;

  function describeConflict(conflict: MergeConflict) {
    if (isSpatial(conflict)) {
      return fillTemplate(m.conflictTypes.exclusive_overlap, {
        first: labelOf(conflict.featureIds[0]),
        second: labelOf(conflict.featureIds[1]),
        area: number.format(conflict.intersectionM2),
        threshold: number.format(conflict.thresholdM2),
      });
    }
    return fillTemplate(m.conflictTypes[conflict.type], {
      label: labelOf(conflict.featureId, conflict.target ?? conflict.source),
    });
  }

  function renderOptions(conflict: MergeConflict) {
    const name = `conflict-${conflict.id}`;
    const choice = choices[conflict.id];
    const radio = (value: string, label: string, next: Choice) => (
      <label className="merge-option" key={value}>
        <input
          type="radio"
          name={name}
          value={value}
          checked={
            !!choice &&
            `${choice.action}:${"featureId" in choice ? (choice.featureId ?? "") : ""}` ===
              value
          }
          onChange={() => setChoice(conflict.id, next)}
        />
        <span>{label}</span>
      </label>
    );

    if (!isSpatial(conflict)) {
      return [
        radio("keep_target:", m.keepTarget, { action: "keep_target" }),
        radio("keep_source:", m.keepSource, { action: "keep_source" }),
        radio(
          "remove:",
          fillTemplate(m.removeFeature, {
            label: labelOf(
              conflict.featureId,
              conflict.target ?? conflict.source,
            ),
          }),
          { action: "remove" },
        ),
      ];
    }

    return conflict.featureIds.flatMap((featureId) => {
      const feature = featureById(featureId);
      const label = labelOf(featureId);
      const options = [
        radio(`remove:${featureId}`, fillTemplate(m.removeFeature, { label }), {
          action: "remove",
          featureId,
        }),
      ];
      if (feature) {
        options.push(
          radio(
            `redraw:${featureId}`,
            fillTemplate(m.redrawFeature, { label }),
            {
              action: "redraw",
              featureId,
              text:
                choice?.action === "redraw" && choice.featureId === featureId
                  ? choice.text
                  : formatCoordinates(feature.geometry as InterventionGeometry),
            },
          ),
        );
      }
      return options;
    });
  }

  const resultFeatures = preview.features
    .map((feature) => interventionSchema.safeParse(feature))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  return (
    <div className="merge-layout">
      <section aria-labelledby="merge-summary-title" className="editor-form">
        <h2 id="merge-summary-title">{m.summaryTitle}</h2>
        <p>
          {fillTemplate(m.intro, {
            source: preview.source.label,
            target: branchTitle,
          })}
        </p>
        <p className="field-help">{m.ancestor[preview.ancestor.kind]}</p>
        <ul className="merge-decisions">
          {Object.entries(decisionCounts).map(([decision, count]) => (
            <li key={decision}>
              <strong>{count}</strong>{" "}
              {m.decisions[decision as keyof MergeMessages["decisions"]] ??
                decision}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="merge-conflicts-title" className="editor-form">
        <h2 id="merge-conflicts-title">{m.conflictsTitle}</h2>
        {preview.conflicts.length === 0 ? (
          <p className="empty-message">{m.noConflicts}</p>
        ) : (
          <ol className="merge-conflicts">
            {preview.conflicts.map((conflict) => {
              const unresolved = preview.unresolved.includes(conflict.id);
              const choice = choices[conflict.id];
              const redrawId = `redraw-${conflict.id}`;
              return (
                <li
                  key={conflict.id}
                  className={
                    unresolved
                      ? "merge-conflict merge-blocking"
                      : "merge-conflict"
                  }
                >
                  <p className="merge-conflict-text">
                    <span aria-hidden="true">{unresolved ? "▲" : "✓"}</span>{" "}
                    <strong>{unresolved ? m.blocking : m.resolvedOk}:</strong>{" "}
                    {describeConflict(conflict)}
                  </p>
                  <fieldset>
                    <legend>{m.conflictLegend}</legend>
                    {renderOptions(conflict)}
                  </fieldset>
                  {choice?.action === "redraw" ? (
                    <div className="form-field">
                      <label htmlFor={redrawId}>
                        {fillTemplate(m.redrawLabel, {
                          label: labelOf(choice.featureId),
                        })}
                      </label>
                      <p className="field-help" id={`${redrawId}-help`}>
                        {m.redrawHelp}
                      </p>
                      <textarea
                        id={redrawId}
                        rows={5}
                        spellCheck={false}
                        aria-describedby={`${redrawId}-help`}
                        aria-invalid={
                          redrawErrors[conflict.id] ? true : undefined
                        }
                        value={choice.text}
                        onChange={(event) =>
                          setChoice(conflict.id, {
                            ...choice,
                            text: event.target.value,
                          })
                        }
                      />
                      {redrawErrors[conflict.id] ? (
                        <p className="field-error">{m.redrawInvalid}</p>
                      ) : null}
                      {unresolved && checkedSignature !== null ? (
                        <p className="field-error">{m.stillBlocking}</p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {preview.warnings.length > 0 ? (
          <>
            <h3>{m.warningTitle}</h3>
            <ul>
              {preview.warnings.map((warning, index) => (
                <li key={index}>
                  {fillTemplate(m.warningLine, {
                    area: number.format(Number(warning.intersectionM2 ?? 0)),
                  })}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {preview.conflicts.length > 0 ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy !== null}
            onClick={checkDecisions}
          >
            {busy === "check" ? m.checking : m.check}
          </button>
        ) : null}
      </section>

      <section aria-labelledby="merge-result-title" className="editor-canvas">
        <div className="editor-toolbar">
          <h2 id="merge-result-title">{m.resultTitle}</h2>
        </div>
        <RevisionPreview
          ariaLabel={m.resultAria}
          boundary={boundary}
          bounds={bounds}
          features={resultFeatures}
        />
        <ul className="editor-feature-list">
          {preview.features.map((feature) => (
            <li key={feature.id}>
              <div>
                <strong>{labelOf(feature.id)}</strong>
                <span>
                  {kinds[feature.kind as keyof KindMessages] ?? feature.kind} ·{" "}
                  {m.provenance[feature.provenance]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <form
        className="editor-form"
        onSubmit={commit}
        aria-labelledby="merge-commit-title"
      >
        <h2 id="merge-commit-title">{m.commitTitle}</h2>
        <label htmlFor="merge-message">{m.messageLabel}</label>
        <input
          id="merge-message"
          required
          maxLength={100}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        {!ready ? (
          <p className="field-help" id="merge-commit-blocked">
            {preview.tooManyFeatures
              ? fillTemplate(m.tooManyFeatures, { count: preview.featureCount })
              : m.commitBlocked}{" "}
            {preview.tooManyFeatures ? (
              <Link href={`/${locale}/branches/${branchId}`}>
                {m.openEditor}
              </Link>
            ) : null}
          </p>
        ) : null}
        <button
          className="button button-primary"
          type="submit"
          disabled={done || busy !== null || !ready || !message.trim()}
          aria-describedby={!ready ? "merge-commit-blocked" : undefined}
        >
          {busy === "commit" ? m.committing : m.commit}
        </button>
      </form>

      {status ? (
        <div
          className={`editor-status editor-status-${status.tone}`}
          role={status.tone === "error" ? "alert" : "status"}
        >
          <p>{status.text}</p>
          {status.action === "open" ? (
            <Link
              className="button button-secondary"
              href={`/${locale}/branches/${branchId}`}
            >
              {m.openEditor}
            </Link>
          ) : null}
          {status.action === "reload" ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => window.location.reload()}
            >
              {m.reload}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
