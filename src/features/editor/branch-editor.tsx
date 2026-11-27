"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  coordinateCenter,
  parseCoordinates,
  placeAtPoint,
} from "@/features/editor/coordinates";
import {
  createDefaultIntervention,
  geometryTypeForKind,
} from "@/features/editor/defaults";
import {
  clearDraft,
  draftKey,
  readDraft,
  writeDraft,
  type Draft,
} from "@/features/editor/draft";
import {
  addOperation,
  canRedo,
  canUndo,
  createEditorState,
  execute,
  redo,
  removeOperation,
  undo,
  type EditorState,
} from "@/features/editor/editor-state";
import {
  fromFormValues,
  numericFieldsFor,
  toFormValues,
  type FieldErrors,
  type FormField,
  type FormValues,
} from "@/features/editor/form-values";
import {
  canonicalizeFeatures,
  canonicalJson,
  sameSnapshot,
} from "@/lib/geo/canonical";
import type { BoundingBox, DrawableGeometry } from "@/lib/geo/project";
import { footprintFitsSurface, ringCoversPoint } from "@/lib/geo/planar";
import {
  urbanObjectFootprint,
  urbanObjectsOverlap,
} from "@/lib/geo/urban-object";
import { describeIntervention, fillTemplate } from "@/features/editor/describe";
import {
  RevisionPreview,
  revisionPositionAt,
} from "@/features/versions/revision-preview";
import { TerrainObjectThumbnail } from "@/features/terrain/terrain-object-thumbnail";
import { InterventionPerspective } from "./intervention-perspective";
import type { Locale } from "@/lib/i18n/locales";
import type { OsmContext } from "@/features/places/site-data";
import {
  editableKinds,
  saveRevisionResponseSchema,
  type BranchHead,
  type EditableKind,
  type Intervention,
} from "@/lib/schemas/intervention";
import {
  MAX_PUBLICATION_LABEL_LENGTH,
  MAX_PUBLICATION_SUMMARY_LENGTH,
  publishRevisionResponseSchema,
} from "@/lib/schemas/publication";
import type esMessages from "@/messages/es.json";
import {
  terrainObjects,
  type RevisionObjectKind,
} from "@/lib/schemas/terrain-objects";

type EditorMessages = (typeof esMessages)["editor"];
type PaletteGroup = Exclude<keyof typeof esMessages.terrain.placement.groups, "construction">;
const branchObjectGroups: Record<PaletteGroup, RevisionObjectKind[]> = {
  shade: ["parasol"],
  furniture: ["bench", "planter", "picnic_table", "lamp"],
  activity: ["stall", "fountain", "stage"],
  access: ["ramp"],
};
const paletteGroups = Object.keys(branchObjectGroups) as PaletteGroup[];
const branchObjects = Object.values(branchObjectGroups).flat();

/** The owner's own publications of this branch; never includes other people's data. */
export type OwnerPublication = {
  id: string;
  revisionId: string;
  label: string;
  publishedAt: string;
  /** Hidden by moderation: no public page, shown as text instead of a link. */
  hidden: boolean;
  /** Public moderation reason, when the author may read it. */
  hiddenReason?: string | null;
};

export type BranchEditorProps = {
  locale: Locale;
  messages: EditorMessages;
  perspectiveCopy: (typeof esMessages)["terrain"]["perspective"];
  objectsCopy: Pick<(typeof esMessages)["terrain"], "furniture" | "placement">;
  head: BranchHead;
  publications: OwnerPublication[];
  userId: string;
  bounds: BoundingBox;
  boundary: DrawableGeometry;
  center: [number, number];
  pilotContext: OsmContext;
};

type Status = {
  tone: "success" | "error" | "info";
  text: string;
  action?: "reload" | "signIn" | "open";
  href?: string;
};

const numericLabels: Record<string, keyof EditorMessages> = {
  heightM: "heightLabel",
  canopyDiameterM: "canopyLabel",
  stallCount: "stallsLabel",
  moduleM2: "moduleLabel",
  widthM: "widthLabel",
};

const fill = fillTemplate;

const publicationHrefFor = (locale: Locale, id: string) =>
  `/${locale}/publications/${id}`;

function marketAndTreeOverlap(first: Intervention, second: Intervention) {
  const [tree, market] =
    first.kind === "shade_tree" ? [first, second] : [second, first];
  return (
    tree.kind === "shade_tree" &&
    market.kind === "temporary_market" &&
    ringCoversPoint(tree.geometry.coordinates, market.geometry.coordinates[0])
  );
}

export function BranchEditor({
  locale,
  messages: m,
  perspectiveCopy,
  objectsCopy,
  head,
  publications: initialPublications,
  userId,
  bounds,
  boundary,
  center,
  pilotContext,
}: BranchEditorProps) {
  const storageKey = draftKey(userId, head.siteId, head.branchId);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  const newFormValues = (
    kind: EditableKind,
    objectType: RevisionObjectKind = "bench",
  ): FormValues =>
    toFormValues(
      createDefaultIntervention(
        kind,
        crypto.randomUUID(),
        center,
        {
          label:
            kind === "urban_object"
              ? objectsCopy.furniture[objectType]
              : m.kinds[kind],
          timeSlot: m.defaults.timeSlot,
        },
        objectType,
      ),
      "add",
    );

  const [editor, setEditor] = useState<EditorState>(() =>
    createEditorState(head.features),
  );
  const [showPerspective, setShowPerspective] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const [savedFeatures, setSavedFeatures] = useState<readonly Intervention[]>(
    head.features,
  );
  const [baseRevisionId, setBaseRevisionId] = useState(head.revisionId);
  const [draftOffer, setDraftOffer] = useState<Draft | null>(() => {
    const draft = readDraft(window.localStorage, storageKey);
    return draft && !sameSnapshot(draft.features, head.features) ? draft : null;
  });
  const [form, setForm] = useState<FormValues>(() =>
    newFormValues("shade_canopy"),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const [paletteGroup, setPaletteGroup] = useState<PaletteGroup>("furniture");
  const [revisionMessage, setRevisionMessage] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const pendingSave = useRef<{ signature: string; key: string } | null>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const canvasPanel = useRef<HTMLElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const justDragged = useRef(false);
  const [publications, setPublications] =
    useState<OwnerPublication[]>(initialPublications);
  const [publishLabel, setPublishLabel] = useState(
    head.title.slice(0, MAX_PUBLICATION_LABEL_LENGTH),
  );
  const [publishSummary, setPublishSummary] = useState("");
  const [publishConsent, setPublishConsent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<
    "label" | "summary" | "consent" | null
  >(null);
  const pendingPublish = useRef<{ signature: string; key: string } | null>(
    null,
  );

  const dirty = !sameSnapshot(editor.features, savedFeatures);
  const headPublication = publications.find(
    (publication) => publication.revisionId === baseRevisionId,
  );
  const publishBlocker = dirty
    ? m.publishNeedsSave
    : savedFeatures.length === 0
      ? m.publishNeedsContent
      : headPublication
        ? headPublication.hidden
          ? m.publicationHiddenHead
          : m.alreadyPublished
        : null;
  // A hidden publication has no public page, so it never gets a link.
  const headPublicationLink =
    headPublication && !headPublication.hidden
      ? publicationHrefFor(locale, headPublication.id)
      : null;
  const publicationHref = (id: string) => publicationHrefFor(locale, id);

  // Persist unsaved work per account, site, and branch. A pending recovery offer is left untouched.
  useEffect(() => {
    if (draftOffer) return;
    if (dirty) {
      writeDraft(window.localStorage, storageKey, {
        baseRevisionId,
        savedAt: new Date().toISOString(),
        features: [...editor.features],
      });
    } else {
      clearDraft(window.localStorage, storageKey);
    }
  }, [baseRevisionId, dirty, draftOffer, editor.features, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function startEdit(feature: Intervention) {
    setForm(toFormValues(feature, "edit"));
    setFieldErrors({});
    formHeading.current?.focus();
  }

  function viewFeature(id: string) {
    setFocusRequest((previous) => ({
      id,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
    setShowPerspective(true);
    previewHeading.current?.focus();
  }

  function resetForm(
    kind: EditableKind = form.kind,
    objectType: RevisionObjectKind = form.objectType,
  ) {
    const available = branchObjects.includes(objectType) ? objectType : "bench";
    setForm(newFormValues(kind, available));
    if (kind === "urban_object") openObjectGroup(available);
    setFieldErrors({});
  }

  function openObjectGroup(objectType: RevisionObjectKind) {
    const group = paletteGroups.find((key) =>
      branchObjectGroups[key].includes(objectType),
    );
    if (group) setPaletteGroup(group);
  }

  function selectIntervention(value: string) {
    const objectType = branchObjects.find((kind) => kind === value);
    if (objectType) {
      if (form.kind !== "urban_object") {
        resetForm("urban_object", objectType);
      } else {
        setForm(selectObject(objectType));
        openObjectGroup(objectType);
        setFieldErrors({});
      }
      return;
    }
    const kind = editableKinds.find((kind) => kind === value);
    if (kind) resetForm(kind);
  }

  function submitFeature(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commitFeature(form);
  }

  function commitFeature(values: FormValues) {
    const result = fromFormValues(values);
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }

    const label = result.feature.properties.label;
    const candidate = result.feature;
    const original = editor.features.find(({ id }) => id === candidate.id);
    if (
      candidate.kind === "urban_object" &&
      boundary.type === "Polygon" &&
      !footprintFitsSurface(
        candidate.geometry.coordinates[0].slice(0, -1).map(([x, y]) => [x, y]),
        [boundary.coordinates.map((ring) => ring.map(([x, y]) => [x, y]))],
      )
    ) {
      setFieldErrors({ coordinates: "objectOutside" });
      return;
    }
    if (
      (!original ||
        canonicalJson(original.geometry) !==
          canonicalJson(candidate.geometry)) &&
      editor.features.some(
        (feature) =>
          feature.id !== candidate.id &&
          urbanObjectsOverlap(candidate, feature),
      )
    ) {
      setFieldErrors({ coordinates: "objectOverlap" });
      return;
    }
    if (
      (!original ||
        canonicalJson(original.geometry) !==
          canonicalJson(candidate.geometry)) &&
      editor.features.some(
        (feature) =>
          feature.id !== candidate.id &&
          marketAndTreeOverlap(candidate, feature),
      )
    ) {
      setFieldErrors({ coordinates: "marketTreeOverlap" });
      return;
    }
    if (values.mode === "add") {
      setEditor((state) =>
        execute(state, addOperation(state.features, result.feature)),
      );
      setAnnouncement(fill(m.added, { label }));
    } else {
      const before = editor.features.find(
        (feature) => feature.id === result.feature.id,
      );
      if (before) {
        setEditor((state) =>
          execute(state, { type: "update", before, after: result.feature }),
        );
        setAnnouncement(fill(m.updated, { label }));
      }
    }
    resetForm(values.kind, values.objectType);
  }

  function selectObject(kind: RevisionObjectKind) {
    if (kind === form.objectType) return form;
    return {
      ...newFormValues("urban_object", kind),
      coordinates: form.coordinates,
    };
  }

  function removeFeature(feature: Intervention) {
    const operation = removeOperation(editor.features, feature.id);
    if (!operation) return;
    setEditor((state) => execute(state, operation));
    setAnnouncement(fill(m.removed, { label: feature.properties.label }));
    if (form.id === feature.id) resetForm();
  }

  function recoverDraft() {
    if (!draftOffer) return;
    const after = draftOffer.features;
    setEditor((state) =>
      execute(state, { type: "replace", before: state.features, after }),
    );
    setDraftOffer(null);
    setStatus({ tone: "info", text: m.draftRecovered });
  }

  function discardDraft() {
    clearDraft(window.localStorage, storageKey);
    setDraftOffer(null);
  }

  function describeFeatureError(
    code: string,
    index: unknown,
    sent: Intervention[],
  ) {
    if (code === "feature_outside_site") return m.outsideSite;
    if (code === "market_tree_overlap") return m.fieldErrors.marketTreeOverlap;
    if (code === "urban_object_overlap") return m.fieldErrors.objectOverlap;
    const reason =
      m.reasons[code as keyof EditorMessages["reasons"]] ??
      m.reasons.invalid_feature;
    const feature = typeof index === "number" ? sent[index] : undefined;
    return feature
      ? fill(m.featureError, { label: feature.properties.label, reason })
      : `${m.genericError} ${reason}`;
  }

  async function saveRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) {
      setStatus({ tone: "info", text: m.nothingToSave });
      return;
    }

    const snapshot = editor.features;
    const features = canonicalizeFeatures(snapshot);
    const payload = {
      expectedHeadId: baseRevisionId,
      message: revisionMessage.trim(),
      features,
    };
    const signature = canonicalJson(payload);
    // Retrying the same payload reuses its key, so a lost response cannot create a duplicate.
    if (pendingSave.current?.signature !== signature) {
      pendingSave.current = { signature, key: crypto.randomUUID() };
    }

    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch(
        `/api/v1/branches/${head.branchId}/revisions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": pendingSave.current.key,
          },
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      pendingSave.current = null;

      if (response.status === 201) {
        const saved = saveRevisionResponseSchema.parse(body);
        setSavedFeatures(snapshot);
        setBaseRevisionId(saved.data.revisionId);
        setRevisionMessage("");
        setStatus({ tone: "success", text: m.saved });
        return;
      }

      const error = (body ?? {}) as {
        code?: string;
        details?: { featureIndex?: number; path?: string };
      };
      if (response.status === 401) {
        setStatus({ tone: "error", text: m.signedOut, action: "signIn" });
      } else if (response.status === 404) {
        setStatus({ tone: "error", text: m.notFound });
      } else if (error.code === "stale_head") {
        setStatus({ tone: "error", text: m.staleHead, action: "reload" });
      } else if (response.status === 422 && error.code) {
        const pathIndex = Number(error.details?.path?.split(".")[1]);
        const index =
          error.details?.featureIndex ??
          (Number.isInteger(pathIndex) ? pathIndex : undefined);
        setStatus({
          tone: "error",
          text: describeFeatureError(error.code, index, features),
        });
      } else {
        setStatus({ tone: "error", text: m.genericError });
      }
    } catch {
      setStatus({ tone: "error", text: m.network });
    } finally {
      setSaving(false);
    }
  }

  async function publishRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publishBlocker) {
      setStatus({
        tone: "info",
        text: publishBlocker,
        ...(headPublicationLink
          ? { action: "open" as const, href: headPublicationLink }
          : {}),
      });
      return;
    }

    const payload = {
      label: publishLabel.trim(),
      summary: publishSummary.trim(),
    };
    if (!payload.label) return setPublishError("label");
    if (!payload.summary) return setPublishError("summary");
    if (!publishConsent) return setPublishError("consent");
    setPublishError(null);

    const revisionId = baseRevisionId;
    const signature = canonicalJson({ revisionId, ...payload });
    if (pendingPublish.current?.signature !== signature) {
      pendingPublish.current = { signature, key: crypto.randomUUID() };
    }

    setPublishing(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/v1/revisions/${revisionId}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pendingPublish.current.key,
        },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      pendingPublish.current = null;

      if (response.status === 201) {
        const published = publishRevisionResponseSchema.parse(body).data;
        setPublications((current) => [
          {
            id: published.publicationId,
            revisionId: published.revisionId,
            label: payload.label,
            publishedAt: published.publishedAt,
            hidden: false,
          },
          ...current,
        ]);
        setPublishSummary("");
        setPublishConsent(false);
        setStatus({
          tone: "success",
          text: m.published,
          action: "open",
          href: publicationHref(published.publicationId),
        });
        return;
      }

      const error = (body ?? {}) as {
        code?: string;
        details?: { publicationId?: string };
      };
      if (response.status === 401) {
        setStatus({ tone: "error", text: m.signedOut, action: "signIn" });
      } else if (response.status === 404) {
        setStatus({ tone: "error", text: m.notFound });
      } else if (error.code === "already_published") {
        const publicationId = error.details?.publicationId;
        setStatus({
          tone: "info",
          text: m.alreadyPublished,
          ...(publicationId
            ? { action: "open" as const, href: publicationHref(publicationId) }
            : {}),
        });
      } else if (error.code === "empty_revision") {
        setStatus({ tone: "error", text: m.publishNeedsContent });
      } else if (error.code === "profile_required") {
        setStatus({ tone: "error", text: m.profileRequired });
      } else {
        setStatus({ tone: "error", text: m.publishError });
      }
    } catch {
      setStatus({ tone: "error", text: m.network });
    } finally {
      setPublishing(false);
    }
  }

  const geometryType = geometryTypeForKind[form.kind];
  const parsedDraft = parseCoordinates(form.coordinates, geometryType);
  const draftGeometry = parsedDraft.ok
    ? form.kind === "urban_object" && parsedDraft.geometry.type === "Point"
      ? urbanObjectFootprint(form.objectType, parsedDraft.geometry.coordinates)
      : parsedDraft.geometry
    : null;
  const setField = (field: FormField, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  function pickPoint(longitude: number, latitude: number) {
    setField(
      "coordinates",
      placeAtPoint(form.coordinates, geometryType, longitude, latitude),
    );
    setFieldErrors((current) => ({ ...current, coordinates: undefined }));
    setAnnouncement(m.picked);
  }
  function nudgePlacement(event: KeyboardEvent<HTMLButtonElement>) {
    if (!parsedDraft.ok) return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const meters = event.shiftKey ? 8 : 1;
    const [x, y] = coordinateCenter(parsedDraft.geometry);
    const [west, south, east, north] = bounds;
    pickPoint(
      Math.min(
        east,
        Math.max(
          west,
          x +
            (direction[0] * meters) / (111_195 * Math.cos((y * Math.PI) / 180)),
        ),
      ),
      Math.min(north, Math.max(south, y + (direction[1] * meters) / 111_195)),
    );
  }
  const errorId = (field: FormField) => `editor-error-${field}`;
  const placementError =
    fieldErrors.coordinates === "objectOverlap" ||
    fieldErrors.coordinates === "objectOutside" ||
    fieldErrors.coordinates === "marketTreeOverlap";
  const fieldProps = (field: FormField) => ({
    id: `editor-${field}`,
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? errorId(field) : undefined,
  });
  const fieldError = (field: FormField) =>
    fieldErrors[field] ? (
      <p className="field-error" id={errorId(field)}>
        {m.fieldErrors[fieldErrors[field]!]}
      </p>
    ) : null;

  const summary = (feature: Intervention) =>
    describeIntervention(feature, m.summary, number);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const returnTo = `/${locale}/branches/${head.branchId}`;

  return (
    <div className="editor-layout">
      {draftOffer ? (
        <section className="draft-offer" aria-labelledby="draft-offer-title">
          <p id="draft-offer-title">
            {fill(m.draftFound, {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(draftOffer.savedAt)),
            })}
          </p>
          {draftOffer.baseRevisionId !== head.revisionId ? (
            <p>{m.draftOlderBase}</p>
          ) : null}
          <div className="button-row">
            <button
              className="button button-primary"
              type="button"
              onClick={recoverDraft}
            >
              {m.draftRecover}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={discardDraft}
            >
              {m.draftDiscard}
            </button>
          </div>
        </section>
      ) : null}

      <form className="editor-workspace" onSubmit={submitFeature} noValidate>
        <div className="editor-form editor-picker">
          <h2 ref={formHeading} tabIndex={-1}>
            {form.mode === "add" ? m.addTitle : m.editTitle}
          </h2>

          {form.mode === "add" ? (
            <>
              <label htmlFor="editor-kind">{m.kindLabel}</label>
              <select
                id="editor-kind"
                value={
                  form.kind === "urban_object" ? form.objectType : form.kind
                }
                onChange={(event) => selectIntervention(event.target.value)}
              >
                {editableKinds
                  .filter((kind) => kind !== "urban_object")
                  .map((kind) => (
                    <option key={kind} value={kind}>
                      {m.kinds[kind]}
                    </option>
                  ))}
                {paletteGroups.map((group) => (
                  <optgroup
                    key={group}
                    label={objectsCopy.placement.groups[group]}
                  >
                    {branchObjectGroups[group].map((kind) => (
                      <option key={kind} value={kind}>
                        {objectsCopy.furniture[kind]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </>
          ) : (
            <p className="form-kind">
              {form.kind === "urban_object"
                ? objectsCopy.furniture[form.objectType]
                : m.kinds[form.kind]}
            </p>
          )}

          {form.kind === "urban_object" &&
            form.mode === "add" &&
            !showPerspective && (
              <div className="editor-object-palette">
                <label htmlFor="editor-object-category">
                  {objectsCopy.placement.filter}
                </label>
                <select
                  id="editor-object-category"
                  value={paletteGroup}
                  onChange={(event) => {
                    const group = event.target.value as PaletteGroup;
                    setPaletteGroup(group);
                    if (!branchObjectGroups[group].includes(form.objectType))
                      setForm(selectObject(branchObjectGroups[group][0]));
                    setFieldErrors({});
                  }}
                >
                  {paletteGroups.map(
                    (key) => (
                      <option key={key} value={key}>
                        {objectsCopy.placement.groups[key]}
                      </option>
                    ),
                  )}
                </select>
                <div className="terrain-catalog-tiles">
                  {branchObjectGroups[paletteGroup].map((kind) => {
                    const label = objectsCopy.furniture[kind];
                    const { width, depth } = terrainObjects[kind];
                    return (
                      <button
                        key={kind}
                        type="button"
                        aria-label={label}
                        aria-pressed={form.objectType === kind}
                        className="button shade-object-source"
                        onClick={(event) => {
                          if (event.detail > 0 && justDragged.current) return;
                          if (form.objectType !== kind) {
                            setForm(selectObject(kind));
                            setFieldErrors({});
                          }
                          setShowPerspective(false);
                        }}
                        onPointerDown={(event) => {
                          if (!event.isPrimary || event.button !== 0) return;
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          justDragged.current = false;
                          dragStart.current = {
                            x: event.clientX,
                            y: event.clientY,
                          };
                        }}
                        onPointerUp={(event) => {
                          const start = dragStart.current;
                          dragStart.current = null;
                          if (
                            !start ||
                            Math.hypot(
                              event.clientX - start.x,
                              event.clientY - start.y,
                            ) < 8
                          )
                            return;
                          justDragged.current = true;
                          const svg =
                            canvasPanel.current?.querySelector<SVGSVGElement>(
                              ".editor-preview-pick",
                            );
                          const point =
                            svg &&
                            revisionPositionAt(
                              svg,
                              bounds,
                              event.clientX,
                              event.clientY,
                            );
                          if (!point) return;
                          const chosen = selectObject(kind);
                          const coordinates = placeAtPoint(
                            chosen.coordinates,
                            "Point",
                            ...point,
                          );
                          setForm({ ...chosen, coordinates });
                          commitFeature({ ...chosen, coordinates });
                          event.preventDefault();
                        }}
                        onPointerCancel={() => {
                          dragStart.current = null;
                        }}
                        onLostPointerCapture={() => {
                          dragStart.current = null;
                        }}
                      >
                        <TerrainObjectThumbnail kind={kind} />
                        <span>{label}</span>
                        <small>
                          {fill(objectsCopy.placement.dimensions, {
                            width: number.format(width),
                            depth: number.format(depth),
                          })}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
        </div>

        <section
          ref={canvasPanel}
          className="editor-canvas"
          aria-labelledby="editor-preview-title"
        >
          <div className="editor-toolbar">
            <h2 id="editor-preview-title" ref={previewHeading} tabIndex={-1}>
              {m.previewTitle}
            </h2>
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                disabled={!canUndo(editor)}
                onClick={() => {
                  setEditor(undo);
                  setAnnouncement(m.undone);
                }}
              >
                {m.undo}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={!canRedo(editor)}
                onClick={() => {
                  setEditor(redo);
                  setAnnouncement(m.redone);
                }}
              >
                {m.redo}
              </button>
            </div>
          </div>
          {boundary.type === "Polygon" && (
            <div className="terrain-actions editor-preview-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  resetForm("urban_object");
                  setShowPerspective(false);
                  formHeading.current?.focus();
                }}
              >
                {m.objectPalette}
              </button>
              <button
                className="button button-secondary"
                type="button"
                aria-pressed={showPerspective}
                onClick={() => {
                  setFocusRequest(null);
                  setShowPerspective((current) => !current);
                }}
              >
                {m.preview3d}
              </button>
            </div>
          )}
          {showPerspective && boundary.type === "Polygon" ? (
            <>
              <InterventionPerspective
                key={focusRequest?.sequence ?? 0}
                boundary={boundary}
                center={center}
                features={editor.features}
                copy={{ ...perspectiveCopy, graphic: m.preview3dAria }}
                initialFocusId={focusRequest?.id}
                pilotContext={pilotContext}
              />
              <p className="editor-preview-help field-help">{m.preview3dHint}</p>
            </>
          ) : (
            <>
              <RevisionPreview
                ariaLabel={m.previewAria}
                boundary={boundary}
                bounds={bounds}
                features={editor.features}
                selectedId={form.mode === "edit" ? form.id : undefined}
                draft={draftGeometry}
                markDraftCenter={form.kind === "urban_object"}
                onPick={pickPoint}
              />
              <p className="editor-preview-help field-help">
                {form.kind === "urban_object" ? m.objectPlanHint : m.pickHint}
              </p>
            </>
          )}
          <p className={dirty ? "pending-state pending-dirty" : "pending-state"}>
            <span aria-hidden="true">{dirty ? "●" : "○"}</span>{" "}
            {dirty ? m.pending : m.clean}
          </p>
        </section>

        <div className="editor-form editor-placement">
          <label htmlFor="editor-label">{m.labelLabel}</label>
          <input
            {...fieldProps("label")}
            value={form.label}
            maxLength={80}
            onChange={(event) => setField("label", event.target.value)}
          />
          {fieldError("label")}

          {numericFieldsFor(form).map(({ field, min, max, integer }) => (
            <div className="form-field" key={field}>
              <label htmlFor={`editor-${field}`}>
                {m[numericLabels[field]] as string} ({number.format(min)}–
                {number.format(max)})
              </label>
              <input
                {...fieldProps(field)}
                type="number"
                inputMode={integer ? "numeric" : "decimal"}
                min={min}
                max={max}
                step={integer ? 1 : "any"}
                value={form[field]}
                onChange={(event) => setField(field, event.target.value)}
              />
              {fieldError(field)}
            </div>
          ))}

          {form.kind === "temporary_market" ? (
            <div className="form-field">
              <label htmlFor="editor-timeSlot">{m.timeSlotLabel}</label>
              <input
                {...fieldProps("timeSlot")}
                value={form.timeSlot}
                maxLength={40}
                onChange={(event) => setField("timeSlot", event.target.value)}
              />
              {fieldError("timeSlot")}
            </div>
          ) : null}

          <p className="pick-callout" id="editor-placement-help">
            <span aria-hidden="true">⌖</span>{" "}
              {showPerspective
                ? m.pickObjectIn3d
                : form.kind === "urban_object"
                  ? m.pickObject
                  : m.pickInForm}
          </p>
          {showPerspective && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowPerspective(false)}
            >
              {m.objectPlanAction}
            </button>
          )}
          {placementError && (
            <div role="alert">{fieldError("coordinates")}</div>
          )}
          <div className="button-row">
            <button
              className="button button-primary"
              type="submit"
              aria-describedby="editor-placement-help editor-keyboard-help"
              onKeyDown={nudgePlacement}
            >
              {form.mode === "add" ? m.submitAdd : m.submitEdit}
            </button>
            {form.mode === "edit" ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => resetForm()}
              >
                {m.cancel}
              </button>
            ) : null}
          </div>
          <p className="field-help" id="editor-keyboard-help">
            {m.keyboardPlacement}
          </p>
          <details
            className="coordinates-details"
            open={
              coordinatesOpen ||
              (!placementError && Boolean(fieldErrors.coordinates))
            }
            onToggle={(event) => setCoordinatesOpen(event.currentTarget.open)}
          >
            <summary>{m.coordinatesToggle}</summary>
            <label htmlFor="editor-coordinates">{m.coordinatesLabel}</label>
            <p className="field-help" id="editor-coordinates-help">
              {m.coordinatesHelp[geometryType]}
            </p>
            <textarea
              {...fieldProps("coordinates")}
              aria-describedby={[
                "editor-coordinates-help",
                fieldErrors.coordinates ? errorId("coordinates") : "",
              ]
                .filter(Boolean)
                .join(" ")}
              rows={geometryType === "Point" ? 1 : 5}
              spellCheck={false}
              value={form.coordinates}
              onChange={(event) => setField("coordinates", event.target.value)}
            />
            {!placementError && fieldError("coordinates")}
          </details>
          <p className="editor-next-step">
            {dirty ? (
              <a href="#editor-message">{m.nextSave}</a>
            ) : !publishBlocker ? (
              <a href="#publish-label">{m.nextPublish}</a>
            ) : (
              <span>{headPublication ? m.nextEdit : m.nextAdd}</span>
            )}
          </p>
        </div>
      </form>

      <section className="editor-canvas" aria-labelledby="editor-list-title">
        <h2 id="editor-list-title" className="editor-list-title">
          {m.listTitle}
        </h2>
        {editor.features.length === 0 ? (
          <p className="empty-message">{m.empty}</p>
        ) : null}
        <ul className="editor-feature-list">
          {editor.features.map((feature) => (
            <li key={feature.id}>
              <div>
                <strong>{feature.properties.label}</strong>
                <span>
                  {feature.kind === "urban_object"
                    ? objectsCopy.furniture[feature.properties.objectType]
                    : m.kinds[feature.kind]}{" "}
                  · {m.hypothetical} · {summary(feature)}
                </span>
              </div>
              <div className="button-row">
                {boundary.type === "Polygon" && (
                  <button
                    className="button button-secondary"
                    type="button"
                    aria-label={fill(m.viewIn3dAria, {
                      label: feature.properties.label,
                    })}
                    onClick={() => viewFeature(feature.id)}
                  >
                    {m.viewIn3d}
                  </button>
                )}
                <button
                  className="button button-secondary"
                  type="button"
                  aria-label={fill(m.editAria, {
                    label: feature.properties.label,
                  })}
                  onClick={() => startEdit(feature)}
                >
                  {m.edit}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  aria-label={fill(m.removeAria, {
                    label: feature.properties.label,
                  })}
                  onClick={() => removeFeature(feature)}
                >
                  {m.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside className="editor-panel">
        <form className="editor-form save-form" onSubmit={saveRevision}>
          <h2>{m.saveTitle}</h2>
          <label htmlFor="editor-message">{m.messageLabel}</label>
          <input
            id="editor-message"
            required
            maxLength={100}
            aria-describedby="editor-message-help"
            value={revisionMessage}
            onChange={(event) => setRevisionMessage(event.target.value)}
          />
          <p className="field-help" id="editor-message-help">
            {m.messageHelp}
          </p>
          <button
            className="button button-primary"
            type="submit"
            disabled={saving}
          >
            {saving ? m.saving : m.save}
          </button>
          <p className="field-help">
            {m.headLabel}: <code>{baseRevisionId.slice(0, 8)}</code>
          </p>
        </form>

        <form
          className="editor-form publish-form"
          onSubmit={publishRevision}
          noValidate
          aria-labelledby="publish-title"
        >
          <h2 id="publish-title">{m.publishTitle}</h2>
          {publishBlocker ? (
            <p className="field-help publish-blocker" id="publish-blocker">
              {publishBlocker}{" "}
              {headPublicationLink ? (
                <Link href={headPublicationLink}>{m.openPublication}</Link>
              ) : null}
            </p>
          ) : null}
          <label htmlFor="publish-label">{m.publishLabelLabel}</label>
          <input
            id="publish-label"
            required
            maxLength={MAX_PUBLICATION_LABEL_LENGTH}
            aria-invalid={publishError === "label" ? true : undefined}
            aria-describedby={
              publishError === "label" ? "publish-error-label" : undefined
            }
            value={publishLabel}
            onChange={(event) => setPublishLabel(event.target.value)}
          />
          {publishError === "label" ? (
            <p className="field-error" id="publish-error-label">
              {m.publishLabelRequired}
            </p>
          ) : null}
          <label htmlFor="publish-summary">{m.publishSummaryLabel}</label>
          <textarea
            id="publish-summary"
            required
            rows={4}
            maxLength={MAX_PUBLICATION_SUMMARY_LENGTH}
            aria-invalid={publishError === "summary" ? true : undefined}
            aria-describedby={[
              "publish-summary-help",
              publishError === "summary" ? "publish-error-summary" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            value={publishSummary}
            onChange={(event) => setPublishSummary(event.target.value)}
          />
          <p className="field-help" id="publish-summary-help">
            {m.publishSummaryHelp}
          </p>
          {publishError === "summary" ? (
            <p className="field-error" id="publish-error-summary">
              {m.publishSummaryRequired}
            </p>
          ) : null}
          <div className="consent-field">
            <input
              id="publish-consent"
              type="checkbox"
              checked={publishConsent}
              aria-invalid={publishError === "consent" ? true : undefined}
              aria-describedby={
                publishError === "consent" ? "publish-error-consent" : undefined
              }
              onChange={(event) => setPublishConsent(event.target.checked)}
            />
            <label htmlFor="publish-consent">{m.publishConsent}</label>
          </div>
          {publishError === "consent" ? (
            <p className="field-error" id="publish-error-consent">
              {m.publishConsentRequired}
            </p>
          ) : null}
          <button
            className="button button-primary"
            type="submit"
            disabled={publishing || publishBlocker !== null}
            aria-describedby={publishBlocker ? "publish-blocker" : undefined}
          >
            {publishing ? m.publishing : m.publish}
          </button>
        </form>

        <section
          className="editor-form publications-list"
          aria-labelledby="publications-title"
        >
          <h2 id="publications-title">{m.publicationsTitle}</h2>
          {publications.length === 0 ? (
            <p className="empty-message">{m.publicationsEmpty}</p>
          ) : (
            <ul>
              {publications.map((publication) => (
                <li key={publication.id}>
                  {publication.hidden ? (
                    <strong>{publication.label}</strong>
                  ) : (
                    <Link href={publicationHref(publication.id)}>
                      {publication.label}
                    </Link>
                  )}
                  <span>
                    {fill(m.publishedOn, {
                      date: dateFormat.format(
                        new Date(publication.publishedAt),
                      ),
                    })}
                    {publication.hidden
                      ? ` · ${m.publicationHidden}${publication.hiddenReason ? ` · ${fill(m.publicationHiddenReason, { reason: publication.hiddenReason })}` : ""}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div aria-live="polite" role="status" className="sr-only">
          {announcement}
        </div>
        {status ? (
          <div
            className={`editor-status editor-status-${status.tone}`}
            role={status.tone === "error" ? "alert" : "status"}
          >
            <p>{status.text}</p>
            {status.action === "reload" ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => window.location.reload()}
              >
                {m.reloadLatest}
              </button>
            ) : null}
            {status.action === "signIn" ? (
              <Link
                className="button button-secondary"
                href={`/${locale}/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
              >
                {m.signIn}
              </Link>
            ) : null}
            {status.action === "open" && status.href ? (
              <Link className="button button-secondary" href={status.href}>
                {m.openPublication}
              </Link>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
