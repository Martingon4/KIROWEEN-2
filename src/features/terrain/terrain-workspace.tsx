"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type es from "@/messages/es.json";
import { ShadeWorkbench } from "@/features/compare/shade-workbench";
import { furnitureFootprint } from "@/features/compare/shade-geometry";
import { footprintFitsSurface } from "@/lib/geo/planar";
import { terrainDimensions } from "@/lib/schemas/terrain-objects";
import type { OsmContext } from "@/features/places/site-data";
import {
  loadContextWays,
  pilotContextWays,
  projectContext,
  referenceRadius,
} from "./terrain-context";
import { TerrainPerspective } from "./terrain-perspective";
import { TerrainObjectThumbnail } from "./terrain-object-thumbnail";
import { TerrainCapture } from "./terrain-capture";
import {
  accessFootprint,
  fitPhotoCovers,
  isGeneratedPhotoElement,
  isGeneratedBuilding,
  photoOutline,
  photoRegion,
  suggestPhotoOutline,
  suggestPhotoTreeline,
  surfaceWithAccess,
} from "./photo-proposal";
import { createFlatPhotoRelief, reliefCoordinates } from "./terrain-relief";
import { objectFaces, prism, type Face } from "./terrain-perspective-model";
import { terrainExample } from "./terrain-example";
import {
  buildSurface,
  terrainDraftSchema,
  terrainSun,
  type TerrainDraft,
} from "./terrain-model";

const TerrainPhotoScene = lazy(() => import("./terrain-photo-scene"));

const storageKey = "fork-the-city.terrain.v1";

export function TerrainWorkspace({
  copy,
  shadeCopy,
  pilotContext,
  locale,
}: {
  copy: typeof es.terrain;
  shadeCopy: typeof es.compare.shadeScene;
  pilotContext: OsmContext;
  locale: "es" | "en";
}) {
  const [draft, setDraft] = useState<TerrainDraft | null>(null);
  const [designing, setDesigning] = useState(false);
  const [variant, setVariant] = useState<"a" | "b">("a");
  const [view, setView] = useState<"photo" | "orbit" | "plan">("plan");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoRatio, setPhotoRatio] = useState(1);
  const [photoRaster, setPhotoRaster] = useState<ImageData | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoCanRender, setPhotoCanRender] = useState(false);
  const [contextVisible, setContextVisible] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [liveContext, setLiveContext] = useState<
    Awaited<ReturnType<typeof loadContextWays>>
  >([]);
  const contextRequest = useRef<AbortController | null>(null);
  const orbitButton = useRef<HTMLButtonElement>(null);
  const photoRequest = useRef(0);
  function clearPhoto() {
    photoRequest.current++;
    setPhotoUrl("");
    setPhotoRaster(null);
    setPhotoLoading(false);
    setPhotoCanRender(false);
    setEstimatingDepth(false);
  }
  const [status, setStatus] = useState("");
  const [estimatingDepth, setEstimatingDepth] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);

  useEffect(() => {
    if (photoUrl) return () => URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);
  useEffect(() => () => contextRequest.current?.abort(), []);

  const capture = draft?.capture;
  const surface = useMemo(
    () =>
      capture &&
      buildSurface(capture.corners, capture.distance, capture.measuredDepth),
    [capture],
  );
  const contextLocation = capture?.location;
  const passage = draft?.photoLayout?.access;
  const reserved = useMemo(
    () => (capture && passage ? accessFootprint(capture, passage) : null),
    [capture, passage],
  );
  const passageFaces = useMemo((): Face[] => {
    if (!surface || !reserved) return [];
    const height = draft?.relief
      ? reliefCoordinates(surface, draft.relief).elevation
      : () => 0;
    return [
      {
        vertices: reserved.map(([x, y]) => [x, y, height([x, y]) + 0.035]),
        material: [202, 143, 69],
      },
    ];
  }, [draft?.relief, reserved, surface]);
  const photoContextFaces = useMemo((): Face[] => {
    const trees = draft?.photoLayout?.contextTrees;
    if (!surface || !trees?.length) return [];
    const points = surface[0][0];
    const left = Math.min(...points.map(([x]) => x));
    const right = Math.max(...points.map(([x]) => x));
    const back = Math.max(...points.map(([, y]) => y));
    const backdrop = prism([
      [left - 1.5, back + 0.15],
      [right + 1.5, back + 0.15],
      [right + 1.5, back + 3.8],
      [left - 1.5, back + 3.8],
    ], -0.09, -0.03, [103, 133, 75]);
    return [
      ...backdrop,
      ...trees.flatMap((fraction, index) => objectFaces({
        id: `photo-reference-${index}`,
        kind: "shade_tree",
        coordinates: [left + (right - left) * fraction, back + 1.3],
        heightM: 4.8 + (index % 3) * 0.8,
        canopyDiameterM: 2.5,
      }).map((face): Face => ({
        ...face,
        material: face.material.map((channel) => Math.round(channel * 0.83)) as Face["material"],
      }))),
    ];
  }, [draft?.photoLayout?.contextTrees, surface]);
  const context = useMemo(() => {
    if (!surface || !contextLocation || !contextVisible) return null;
    const live = projectContext(liveContext, contextLocation, surface);
    if (live) return { reference: live, cached: false };
    const cached = projectContext(
      pilotContextWays(pilotContext, contextLocation),
      contextLocation,
      surface,
    );
    return cached && { reference: cached, cached: true };
  }, [surface, contextLocation, contextVisible, liveContext, pilotContext]);
  const reference = context?.reference;

  function toggleContext() {
    if (contextVisible) {
      contextRequest.current?.abort();
      setContextVisible(false);
      setContextLoading(false);
      return;
    }
    if (!contextLocation || !surface) return;
    setContextVisible(true);
    if (
      liveContext.length &&
      projectContext(liveContext, contextLocation, surface)
    )
      return;
    const request = new AbortController();
    contextRequest.current = request;
    setContextLoading(true);
    void loadContextWays(
      contextLocation,
      referenceRadius(surface),
      request.signal,
    )
      .then((ways) => {
        if (!request.signal.aborted) setLiveContext(ways);
      })
      .catch(() => {
        // The pilot has a local reference extract when Overpass is unavailable.
      })
      .finally(() => {
        if (!request.signal.aborted) setContextLoading(false);
      });
  }
  const illustrativeSun = draft && !draft.capture.location;
  const solar =
    draft &&
    terrainSun(
      illustrativeSun ? terrainExample.capture : draft.capture,
      draft.date,
      draft.time,
    );
  const photographic = view === "photo" && photoCanRender && Boolean(photoUrl);
  const fittedBuilding = draft?.alternatives[variant].find(
    (element) => (element.kind === "community_room" || element.kind === "civic_pavilion") && isGeneratedBuilding(element.id),
  );
  const fittedDimensions =
    fittedBuilding?.kind === "community_room" || fittedBuilding?.kind === "civic_pavilion"
      ? Object.values(terrainDimensions(fittedBuilding.kind, fittedBuilding.dimensionsM)).map(
          new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format,
        )
      : null;
  const optionA = draft?.photoLayout ? copy.photoFit.shadeOption : copy.alternativeA;
  const optionB = draft?.photoLayout ? copy.photoFit.greenOption : copy.alternativeB;
  const shades = {
    ...shadeCopy,
    empty: copy.noObjects,
    graphic: copy.sceneLabel,
    legend: photographic
      ? copy.photoScene.legend
      : view === "plan"
        ? shadeCopy.legend
        : copy.perspective.legend,
    edit: {
      ...shadeCopy.edit,
      help: copy.placeHelp,
      outside: copy.placeOutside,
    },
  };

  function save() {
    if (!draft) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setStatus(copy.saved);
    } catch {
      setStatus(copy.storageUnavailable);
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw && terrainDraftSchema.safeParse(JSON.parse(raw));
      if (
        !saved ||
        !saved.success ||
        !buildSurface(
          saved.data.capture.corners,
          saved.data.capture.distance,
          saved.data.capture.measuredDepth,
        )
      ) {
        setStatus(copy.restoreEmpty);
        return;
      }
      let next = saved.data;
      if (next.photoLayout && next.photoLayout.generation !== 3) {
        const oldLayout = next.photoLayout;
        next = {
          ...next,
          capture: {
            ...next.capture,
            measuredDepth: next.capture.measuredDepth ?? next.capture.distance,
          },
        };
        const ground = buildSurface(
          next.capture.corners,
          next.capture.distance,
          next.capture.measuredDepth,
        )!;
        const access = oldLayout.access && accessFootprint(next.capture, oldLayout.access);
        const allowed = surfaceWithAccess(ground, access);
        const manual = Object.fromEntries((["a", "b"] as const).map((key) => [
          key,
          next.alternatives[key].filter((element) => {
            if (isGeneratedPhotoElement(element.id)) return false;
            const footprint = element.kind === "shade_canopy"
              ? element.coordinates[0].slice(0, -1)
              : element.kind === "shade_tree"
                ? [element.coordinates]
                : furnitureFootprint(element.kind, element.coordinates, element.dimensionsM);
            return footprintFitsSurface(footprint, allowed);
          }),
        ])) as TerrainDraft["alternatives"];
        const generated = fitPhotoCovers(ground, access, manual);
        const alternatives = {
          a: [...generated.a, ...manual.a],
          b: [...generated.b, ...manual.b],
        };
        next = {
          ...next,
          alternatives,
          photoLayout: {
            ...oldLayout,
            generation: 3,
            noFit: (["a", "b"] as const).filter((key) => generated[key].length === 0),
          },
        };
      }
      openDesign(next);
      clearPhoto();
      setStatus(copy.restored);
    } catch {
      setStatus(copy.storageUnavailable);
    }
  }

  function openDesign(next: TerrainDraft, preserveVariant = false) {
    contextRequest.current?.abort();
    setContextLoading(false);
    setContextVisible(false);
    setLiveContext([]);
    setDraft(next);
    setDesigning(true);
    setVariant(
      preserveVariant
        ? variant
        : next.photoLayout && !next.photoLayout.noFit?.includes("a")
          ? "a"
          : next.photoLayout && !next.photoLayout.noFit?.includes("b")
            ? "b"
            : "a",
    );
    setView(
      next.photoLayout
        ? "orbit"
        : next.photoGenerated
          ? photoCanRender
            ? "photo"
            : "orbit"
          : "plan",
    );
    setStatus(
      next.photoLayout?.fitted &&
        (["a", "b"] as const).some((key) =>
          next.alternatives[key].some(({ kind }) => kind === "community_room" || kind === "civic_pavilion"))
        ? copy.photoDesignReady
        : "",
    );
  }

  return (
    <>
      {!designing && (
        <section
          className="terrain-photo"
          aria-labelledby="terrain-photo-title"
        >
          <h2 id="terrain-photo-title">{copy.photoTitle}</h2>
          <p className="field-help">{copy.photoHelp}</p>
          <label className="terrain-field">
            {copy.photoFile}
            <input
              key={photoUrl ? "selected" : "empty"}
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setPhotoLoading(true);
                const request = ++photoRequest.current;
                const url = URL.createObjectURL(file);
                const image = new Image();
                image.onload = () => {
                  if (request !== photoRequest.current) {
                    URL.revokeObjectURL(url);
                    return;
                  }
                  const ratio = image.naturalWidth / image.naturalHeight;
                  if (!Number.isFinite(ratio) || ratio <= 0) {
                    URL.revokeObjectURL(url);
                    setStatus(copy.photoError);
                    setPhotoLoading(false);
                    return;
                  }
                  setPhotoRatio(ratio);
                  setPhotoUrl(url);
                  const canvas = document.createElement("canvas");
                  canvas.width = 64;
                  canvas.height = 64;
                  const context = canvas.getContext("2d");
                  if (!context) {
                    setStatus(copy.photoDesignUnavailable);
                    setPhotoLoading(false);
                    return;
                  }

                  try {
                    context.drawImage(image, 0, 0, 64, 64);
                    const now = new Date();
                    const date = new Date(
                      now.getTime() - now.getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 10);
                    const colors = context.getImageData(0, 0, 64, 64);
                    setPhotoRaster(colors);
                    const suggestion = suggestPhotoOutline(colors, ratio);
                    const detected =
                      suggestion.detected &&
                      Boolean(buildSurface(suggestion.corners, 10));
                    const corners = detected
                      ? suggestion.corners
                      : photoOutline(ratio);
                    const region = photoRegion(corners, ratio);
                    const canRender =
                      image.naturalWidth >= 64 && image.naturalHeight >= 64;
                    setDraft({
                      capture: {
                        corners,
                        distance: 10,
                        measuredDepth: 10,
                        estimatedScale: true,
                        location: null,
                        utcOffset: 0,
                      },
                      example: false,
                      photoGenerated: true,
                      photoLayout: {
                        detected,
                        generation: 3,
                        contextTrees: suggestPhotoTreeline(colors),
                      },
                      relief: canRender ? createFlatPhotoRelief(colors, region) : undefined,
                      date,
                      time: "16:00",
                      alternatives: { a: [], b: [] },
                    });
                    setCaptureKey((current) => current + 1);
                    setStatus("");
                    setPhotoCanRender(canRender);
                    setPhotoLoading(false);
                    if (!canRender) return;
                    setEstimatingDepth(true);
                    void import("./terrain-depth-engine")
                      .then(({ estimatePhotoRelief }) =>
                        estimatePhotoRelief(
                          image,
                          colors,
                          detected ? region : undefined,
                        ),
                      )
                      .then((relief) => {
                        if (request !== photoRequest.current || !relief) return;
                        setDraft((current) =>
                          current?.capture.corners === corners
                            ? { ...current, relief }
                            : current,
                        );
                      })
                      .catch(() => {
                        // A browser without the optional local model can still show and edit the proposal.
                      })
                      .finally(() => {
                        if (request === photoRequest.current)
                          setEstimatingDepth(false);
                      });
                  } catch {
                    setStatus(copy.photoDesignUnavailable);
                    setPhotoLoading(false);
                  }
                };
                image.onerror = () => {
                  URL.revokeObjectURL(url);
                  if (request === photoRequest.current)
                    setStatus(copy.photoError);
                  if (request === photoRequest.current)
                    setPhotoLoading(false);
                };
                image.src = url;
              }}
            />
          </label>
          {photoLoading && <p role="status" className="field-help">{copy.photoLoading}</p>}
          {photoUrl && (
            <button
              type="button"
              className="button"
              onClick={() => {
                clearPhoto();
                if (draft?.photoLayout && !draft.photoLayout.fitted) {
                  setDraft(null);
                  setCaptureKey((current) => current + 1);
                }
              }}
            >
              {copy.removePhoto}
            </button>
          )}
        </section>
      )}
      <div className="terrain-actions terrain-document-actions">
        {designing ? (
          <>
            <button
              type="button"
              className="button"
              onClick={() => {
                setDesigning(false);
                setCaptureKey((current) => current + 1);
                setStatus("");
              }}
            >
              {copy.editCapture}
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={save}
            >
              {copy.save}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                clearPhoto();
                openDesign(terrainExample);
              }}
            >
              {copy.example}
            </button>
            <button type="button" className="button" onClick={restore}>
              {copy.restore}
            </button>
          </>
        )}
      </div>
      <p role="status" className="field-help">
        {status}
      </p>
      {draft?.example && (
        <p className="publication-hypothetical">{copy.exampleNotice}</p>
      )}

      {designing && draft && surface ? (
        <section aria-labelledby="terrain-design-title">
          <h2 id="terrain-design-title">{copy.designTitle}</h2>
          <p className="field-help">{copy.modelHelp}</p>
          {draft.photoLayout && (
            <div className="field-help terrain-fit-result" role="status">
              <p>{!draft.photoLayout.noFit?.includes(variant)
                ? copy.photoFit.summary.replace("{count}", String(draft.alternatives[variant].length))
                : copy.photoFit.noFit}</p>
              {fittedDimensions && <p>{copy.photoFit.dimensions
                .replace("{width}", fittedDimensions[0])
                .replace("{depth}", fittedDimensions[1])}</p>}
              {photoContextFaces.length > 0 && <p>{copy.photoFit.treeline}</p>}
              {reserved && <p>{copy.photoFit.reserved}</p>}
            </div>
          )}
          {draft.photoGenerated && (
            <p className="field-help" role="status">
              {estimatingDepth
                ? copy.depthLoading
                : draft.relief && draft.relief.source !== "color"
                  ? copy.depthReady
                  : copy.depthFallback}
            </p>
          )}
          {draft.capture.estimatedScale && (
            <p className="field-help">{copy.estimatedNotice}</p>
          )}
          {illustrativeSun && (
            <p className="field-help">{copy.illustrativeSun}</p>
          )}
          <div className="terrain-fields">
            <label className="terrain-field">
              {copy.alternative}
              <select
                value={variant}
                onChange={(event) =>
                  setVariant(event.target.value === "b" ? "b" : "a")
                }
              >
                <option value="a">{optionA}</option>
                <option
                  value="b"
                  disabled={Boolean(
                    draft.photoLayout?.noFit?.includes("b") &&
                    draft.alternatives.b.length === 0,
                  )}
                >
                  {optionB}
                </option>
              </select>
            </label>
            <label className="terrain-field">
              {copy.date}
              <input
                type="date"
                required
                value={draft.date}
                onChange={(event) => {
                  const date = event.target.value;
                  if (date) setDraft({ ...draft, date });
                }}
              />
            </label>
            <label className="terrain-field">
              {copy.time}
              <input
                type="time"
                required
                value={draft.time}
                onChange={(event) => {
                  const time = event.target.value;
                  if (time) setDraft({ ...draft, time });
                }}
              />
            </label>
          </div>
          <div
            className="terrain-actions terrain-view-switch"
            role="group"
            aria-label={copy.perspective.views}
          >
            {photoCanRender && photoUrl && (
              <button
                type="button"
                className="button terrain-view-button"
                aria-pressed={photographic}
                onClick={() => setView("photo")}
              >
                {copy.photoScene.title}
              </button>
            )}
            <button
              ref={orbitButton}
              type="button"
              className="button terrain-view-button"
              aria-pressed={!photographic && view !== "plan"}
              onClick={() => setView("orbit")}
            >
              {copy.perspective.title}
            </button>
            <button
              type="button"
              className="button terrain-view-button"
              aria-pressed={view === "plan"}
              onClick={() => setView("plan")}
            >
              {copy.perspective.plan}
            </button>
          </div>
          {!photographic && view !== "plan" && (
            <div className="terrain-context">
              {contextLocation ? (
                <>
                  <button
                    type="button"
                    className="button terrain-view-button"
                    aria-pressed={contextVisible}
                    aria-describedby="terrain-context-note"
                    onClick={toggleContext}
                  >
                    {contextVisible ? copy.context.hide : copy.context.show}
                  </button>
                  <p className="field-help" id="terrain-context-note">
                    {copy.context.request}
                  </p>
                  {contextVisible && (
                    <div role="status" className="field-help">
                      {reference && (
                        <>
                          <p>
                            {copy.context.summary
                              .replace(
                                "{buildings}",
                                String(reference.buildings),
                              )
                              .replace("{routes}", String(reference.routes))}
                          </p>
                          <p>
                            {copy.context.approximate}{" "}
                            {context.cached ? copy.context.cached : ""}{" "}
                            <a href="https://www.openstreetmap.org/copyright">
                              © OpenStreetMap
                            </a>
                          </p>
                        </>
                      )}
                      {contextLoading ? (
                        <p>{copy.context.loading}</p>
                      ) : (
                        !reference && <p>{copy.context.unavailable}</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="field-help">{copy.context.locationRequired}</p>
              )}
            </div>
          )}
          <ShadeWorkbench
            scene={{ surface, elements: draft.alternatives[variant] }}
            solar={solar}
            copy={shades}
            canopySize={3}
            terrain={copy}
            locale={locale}
            renderThumbnail={(kind) => <TerrainObjectThumbnail kind={kind} />}
            onReview={() => {
              setView("orbit");
              orbitButton.current?.focus();
            }}
            compact
            reserved={reserved ?? undefined}
            preview={
              photographic ? (
                <Suspense
                  fallback={
                    <p className="field-help" role="status">
                      {copy.photoScene.loading}
                    </p>
                  }
                >
                  <TerrainPhotoScene
                    photoUrl={photoUrl}
                    ratio={photoRatio}
                    copy={copy.photoScene}
                    scene={{ surface, elements: draft.alternatives[variant] }}
                    solar={solar}
                    relief={draft.relief}
                  />
                </Suspense>
              ) : view !== "plan" ? (
                <TerrainPerspective
                  scene={{ surface, elements: draft.alternatives[variant] }}
                  solar={solar}
                  relief={draft.relief}
                  copy={copy.perspective}
                  reference={reference ?? undefined}
                  additionalFaces={[...passageFaces, ...photoContextFaces]}
                  initialOverviewZoom={draft.photoLayout ? 150 : 120}
                  initiallyElevated={Boolean(draft.photoLayout)}
                  showMarkers={!draft.photoLayout}
                  focusLabels={Object.fromEntries(
                    draft.alternatives[variant].map(({ id, kind }) => [
                      id,
                      kind === "shade_tree"
                        ? shadeCopy.edit.tree
                        : kind === "shade_canopy"
                          ? shadeCopy.edit.canopy
                          : copy.furniture[kind],
                    ]),
                  )}
                />
              ) : undefined
            }
            caption={variant === "a" ? optionA : optionB}
            savedArea={solar ? copy.sunModeled : copy.sunLow}
            onElementsChange={(elements) => {
              setDraft({
                ...draft,
                alternatives: { ...draft.alternatives, [variant]: elements },
              });
              setStatus("");
            }}
          />
        </section>
      ) : (
        <TerrainCapture
          key={captureKey}
          initial={draft}
          photoUrl={photoUrl}
          photoRatio={photoRatio}
          loadingPhoto={photoLoading}
          copy={copy}
          onReady={(next) => {
            openDesign(
              next.photoLayout && photoRaster && next.relief?.source !== "depth"
                ? {
                    ...next,
                    relief: createFlatPhotoRelief(
                      photoRaster,
                      photoRegion(next.capture.corners, photoRatio),
                    ),
                  }
                : next,
              Boolean(draft?.photoLayout?.fitted),
            );
          }}
        />
      )}
    </>
  );
}
