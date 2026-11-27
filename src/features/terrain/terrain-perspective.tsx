"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  furnitureFootprint,
  rectangle,
  shadeRings,
  type ShadeSolar,
} from "@/features/compare/shade-geometry";
import type { ShadeScene } from "@/lib/schemas/shade-scene";
import { reliefCoordinates, type PhotoRelief } from "./terrain-relief";
import type { TerrainReference } from "./terrain-context";
import type { Face } from "./terrain-perspective-model";
import type { ModelPlacement, TerrainOrbit } from "./terrain-orbit-webgl";
import type es from "@/messages/es.json";
import {
  renderTerrainPerspective,
  sceneFaces,
  terrainProjector,
} from "./terrain-perspective-render";
import {
  drawFocusOutline,
  overviewMarkers,
  type TerrainFocusTarget,
} from "./terrain-overview";

const noPlacements: ModelPlacement[] = [];
const noFaces: Face[] = [];
const noFocus: TerrainFocusTarget[] = [];
const canvasWidth = 1040;
const canvasHeight = 620;
const flatHeight = () => 0;

export function TerrainPerspective({
  scene,
  solar,
  relief,
  copy,
  additionalFaces = noFaces,
  placements = noPlacements,
  requestedStalls = 0,
  initiallyElevated = false,
  reference,
  frameReference = true,
  focusLabels,
  additionalFocus = noFocus,
  initialFocusId,
  initialOverviewZoom = 120,
  showMarkers = true,
}: {
  scene: ShadeScene;
  solar: ShadeSolar | null;
  relief?: PhotoRelief;
  copy: typeof es.terrain.perspective;
  additionalFaces?: Face[];
  placements?: ModelPlacement[];
  requestedStalls?: number;
  initiallyElevated?: boolean;
  reference?: TerrainReference;
  frameReference?: boolean;
  focusLabels: Readonly<Record<string, string>>;
  additionalFocus?: TerrainFocusTarget[];
  initialFocusId?: string;
  initialOverviewZoom?: number;
  showMarkers?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const focusSelect = useRef<HTMLSelectElement>(null);
  const groupSelect = useRef<HTMLSelectElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [markerChoices, setMarkerChoices] = useState<TerrainFocusTarget[]>([]);
  const [angle, setAngle] = useState(305);
  const [cameraElevation, setElevation] = useState<number | null>(null);
  const elevation =
    cameraElevation ?? Number(initiallyElevated || Boolean(reference));
  const [overviewZoom, setOverviewZoom] = useState(initialOverviewZoom);
  const [objectZoom, setObjectZoom] = useState(120);
  const [unavailable, setUnavailable] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(initialFocusId ?? null);
  const [detail, setDetail] = useState<{
    orbit: TerrainOrbit;
    canvas: HTMLCanvasElement;
  } | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const helpId = useId();
  const faces = useMemo(
    () => sceneFaces(scene, relief, solar).concat(additionalFaces ?? []),
    [additionalFaces, scene, relief, solar],
  );
  const heightAt = useMemo(
    () =>
      relief ? reliefCoordinates(scene.surface, relief).elevation : flatHeight,
    [relief, scene.surface],
  );
  const focusTargets = useMemo(() => {
    return [
      ...scene.elements.map((element): TerrainFocusTarget => {
        const points =
          element.kind === "shade_canopy"
            ? element.coordinates[0]
            : element.kind === "shade_tree"
              ? rectangle(element.coordinates, element.canopyDiameterM / 2)
              : furnitureFootprint(element.kind, element.coordinates, element.dimensionsM);
        const groundHeight =
          element.kind === "shade_canopy"
            ? Math.max(...points.map(heightAt))
            : heightAt(element.coordinates);
        return {
          id: element.id,
          label: focusLabels[element.id],
          glyph:
            element.kind === "shade_tree"
              ? "●"
              : element.kind === "shade_canopy"
                ? "▰"
                : "◆",
          framing: { points, tallest: element.heightM, groundHeight },
          outline:
            element.kind === "shade_tree"
              ? { points: shadeRings(element)[0], closed: true }
              : undefined,
        };
      }),
      ...additionalFocus,
    ];
  }, [additionalFocus, focusLabels, heightAt, scene.elements]);
  const focused = focusTargets.find(({ id }) => id === focusId);
  const visibleReference = focused ? undefined : reference;
  const framing =
    focused?.framing ?? (frameReference ? reference?.framing : undefined);
  const zoom = focused ? objectZoom : overviewZoom;
  const viewportHeight = (viewportWidth * canvasHeight) / canvasWidth;
  const markers = useMemo(() => {
    if (!showMarkers || focused || !viewportWidth || unavailable) return [];
    const project = terrainProjector(
      scene,
      angle,
      elevation,
      zoom / 100,
      Boolean(relief),
      viewportWidth,
      viewportHeight,
      framing,
      Boolean(detail),
    );
    return overviewMarkers(
      focusTargets,
      project,
      viewportWidth,
      viewportHeight,
    );
  }, [
    angle,
    detail,
    elevation,
    focusTargets,
    focused,
    framing,
    relief,
    scene,
    showMarkers,
    unavailable,
    viewportHeight,
    viewportWidth,
    zoom,
  ]);
  const webglFaces = useMemo(
    () =>
      visibleReference
        ? [...additionalFaces, ...visibleReference.faces]
        : additionalFaces,
    [additionalFaces, visibleReference],
  );

  function turn(delta: number) {
    setAngle((current) => (((current + delta) % 360) + 360) % 360);
  }
  function changeZoom(delta: number) {
    const setZoom = focused ? setObjectZoom : setOverviewZoom;
    setZoom((current) => Math.max(85, Math.min(180, current + delta)));
  }
  function tilt(delta: number) {
    setElevation(Math.max(0, Math.min(1, elevation + delta)));
  }

  function focusObject(id: string | null) {
    setFocusId(id || null);
    setObjectZoom(120);
    setMarkerChoices([]);
  }

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewportWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (markerChoices.length)
      groupSelect.current?.focus();
  }, [markerChoices]);

  useEffect(() => {
    let active = true;
    let orbit: TerrainOrbit | undefined;
    const target = canvas.current;
    if (!target) return;
    const bitmap = document.createElement("canvas");
    bitmap.width = target.width;
    bitmap.height = target.height;
    void import("./terrain-orbit-webgl")
      .then(async ({ createTerrainOrbit }) => {
        if (!active) return;
        orbit = await createTerrainOrbit(bitmap);
        if (active) setDetail({ orbit, canvas: bitmap });
        else orbit.dispose();
      })
      .catch(() => {
        // The schematic renderer supports the same controls without WebGL.
      });
    return () => {
      active = false;
      orbit?.dispose();
    };
  }, []);

  useEffect(() => {
    detail?.orbit.prepare(scene, solar, relief, webglFaces, placements);
  }, [detail, scene, solar, relief, webglFaces, placements]);

  useEffect(() => {
    if (!spinning) return;
    let frame = 0;
    let previous: number | undefined;
    const spin = (now: number) => {
      if (previous === undefined) previous = now;
      if (now - previous >= 32) {
        const step = Math.min(80, now - previous) * 0.02;
        setAngle((current) => (current + step) % 360);
        previous = now;
      }
      frame = requestAnimationFrame(spin);
    };
    frame = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(frame);
  }, [spinning]);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) {
      // A scheduled callback avoids committing state from the rendering effect.
      const frame = requestAnimationFrame(() => setUnavailable(true));
      return () => cancelAnimationFrame(frame);
    }
    if (detail) {
      detail.orbit.render(
        scene,
        angle,
        elevation,
        zoom / 100,
        Boolean(relief),
        framing,
      );
      context.drawImage(detail.canvas, 0, 0);
    } else {
      renderTerrainPerspective(
        context,
        scene,
        solar,
        angle,
        elevation,
        zoom / 100,
        relief,
        faces,
        visibleReference,
        framing,
      );
    }
    if (focused) {
      const project = terrainProjector(
        scene,
        angle,
        elevation,
        zoom / 100,
        Boolean(relief),
        canvasWidth,
        canvasHeight,
        framing,
        Boolean(detail),
      );
      drawFocusOutline(context, focused, project, heightAt);
    }
  }, [
    angle,
    detail,
    elevation,
    faces,
    focused,
    framing,
    heightAt,
    visibleReference,
    relief,
    scene,
    solar,
    zoom,
  ]);

  const shownStalls = detail?.orbit.hasModel("stall")
    ? placements.filter(({ kind }) => kind === "stall").length
    : 0;

  return (
    <>
      <div className="terrain-perspective-controls">
        <label className="terrain-field">
          {copy.camera}
          <select
            value={
              elevation === 0 ? "eye" : elevation === 1 ? "high" : "custom"
            }
            onChange={(event) =>
              setElevation(Number(event.target.value === "high"))
            }
          >
            <option value="eye">{copy.eye}</option>
            <option value="high">{copy.high}</option>
            <option value="custom" disabled>
              {copy.custom}
            </option>
          </select>
        </label>
        {focusTargets.length > 0 && (
          <label className="terrain-field">
            {copy.focusObject}
            <select
              ref={focusSelect}
              value={focused?.id ?? ""}
              onChange={(event) => focusObject(event.target.value)}
            >
              <option value="">{copy.overview}</option>
              {focusTargets.map(({ id, label }, index) => (
                <option key={id} value={id}>
                  {index + 1}. {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="terrain-actions">
          <button
            type="button"
            className="button"
            onClick={() => changeZoom(10)}
          >
            {copy.zoomIn}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => changeZoom(-10)}
          >
            {copy.zoomOut}
          </button>
          {focusTargets.length > 0 && (
            <button
              type="button"
              className="button terrain-view-button"
              aria-pressed={Boolean(focused)}
              onClick={() => focusObject(focused ? null : focusTargets[0].id)}
            >
              {focused ? copy.showWholeSite : copy.focusModels}
            </button>
          )}
          <button
            type="button"
            className="button terrain-view-button"
            aria-pressed={spinning}
            onClick={() => setSpinning((value) => !value)}
          >
            {spinning ? copy.pauseSpin : copy.startSpin}
          </button>
        </div>
      </div>
      {unavailable && <p role="status">{copy.unavailable}</p>}
      <p className="field-help terrain-orbit-help" id={helpId}>
        {copy.orbitHelp}
        {markers.length > 0 ? ` ${copy.markerHelp}` : ""}
      </p>
      {requestedStalls > 0 && detail && (
        <p className="field-help" role="status">
          {copy.stallCount
            .replace("{shown}", String(shownStalls))
            .replace("{total}", String(requestedStalls))}
        </p>
      )}
      <div className="terrain-perspective-stage">
        <div className="terrain-perspective-viewport" ref={viewport}>
          <canvas
            className="terrain-perspective-canvas"
            ref={canvas}
            width={canvasWidth}
            height={canvasHeight}
            role="img"
            aria-label={copy.graphic}
            aria-describedby={helpId}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              setSpinning(false);
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.focus({ preventScroll: true });
              drag.current = {
                pointer: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              };
            }}
            onPointerMove={(event) => {
              const last = drag.current;
              if (last?.pointer !== event.pointerId) return;
              turn(
                ((last.x - event.clientX) * 360) /
                  event.currentTarget.clientWidth,
              );
              tilt((last.y - event.clientY) / event.currentTarget.clientHeight);
              last.x = event.clientX;
              last.y = event.clientY;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setSpinning(false);
                turn(event.key === "ArrowLeft" ? -15 : 15);
              } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                setSpinning(false);
                tilt(event.key === "ArrowUp" ? 0.2 : -0.2);
              }
            }}
            hidden={unavailable}
            data-terrain-relief={relief?.source === "color" ? "color" : relief ? "photo" : "flat"}
            data-context-buildings={reference?.buildings}
            data-context-routes={reference?.routes}
            data-detail-models={
              detail
                ? (["shade_tree", "bench", "planter", "stall"] as const)
                    .filter((kind) => detail.orbit.hasModel(kind))
                    .join(",")
                : undefined
            }
          />
          {markers.map(({ x, y, targets }) => {
            const first = targets[0];
            return (
              <button
                key={first.id}
                type="button"
                className="terrain-overview-marker"
                tabIndex={-1}
                title={
                  targets.length > 1
                    ? copy.markerCount.replace(
                        "{count}",
                        String(targets.length),
                      )
                    : first.label
                }
                aria-label={
                  targets.length > 1
                    ? copy.markerCount.replace(
                        "{count}",
                        String(targets.length),
                      )
                    : copy.markerFocus.replace("{label}", first.label)
                }
                style={{ left: x, top: y }}
                onClick={() => {
                  setSpinning(false);
                  if (targets.length > 1) setMarkerChoices(targets);
                  else {
                    focusObject(first.id);
                    focusSelect.current?.focus({ preventScroll: true });
                  }
                }}
              >
                {targets.length > 1 ? (
                  targets.length
                ) : (
                  <span aria-hidden="true">{first.glyph}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {focused && (
        <p className="terrain-selection" role="status">
          {focused.label}
        </p>
      )}
      {markerChoices.length > 0 && !focused && (
        <div className="terrain-marker-choices">
          <label className="terrain-field">
            {copy.markerChoices}
            <select
              ref={groupSelect}
              value=""
              onChange={(event) => {
                focusObject(event.target.value);
                focusSelect.current?.focus({ preventScroll: true });
              }}
            >
              <option value="" disabled>
                {copy.markerChoose}
              </option>
              {markerChoices.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button terrain-view-button"
            onClick={() => {
              setMarkerChoices([]);
              focusSelect.current?.focus({ preventScroll: true });
            }}
          >
            {copy.markerClose}
          </button>
        </div>
      )}
    </>
  );
}
