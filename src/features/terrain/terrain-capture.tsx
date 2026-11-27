"use client";

import { useState } from "react";
import { footprintFitsSurface } from "@/lib/geo/planar";
import type { Point } from "@/lib/schemas/shade-scene";
import type es from "@/messages/es.json";
import {
  buildSurface,
  photoAccessSchema,
  type Capture,
  type TerrainDraft,
} from "./terrain-model";
import { TerrainOutline } from "./terrain-outline";

import {
  accessFootprint,
  fitPhotoCovers,
  isGeneratedPhotoElement,
  photoOutline,
  surfaceWithAccess,
} from "./photo-proposal";
import { furnitureFootprint } from "@/features/compare/shade-geometry";

export function TerrainCapture({
  initial,
  photoUrl,
  photoRatio,
  loadingPhoto = false,
  copy,
  onReady,
}: {
  initial: TerrainDraft | null;
  photoUrl: string;
  photoRatio: number;
  loadingPhoto?: boolean;
  copy: typeof es.terrain;
  onReady: (draft: TerrainDraft) => void;
}) {
  const [outline, setCorners] = useState<Point[] | null>(
    initial?.capture.corners ?? null,
  );
  const corners = outline ?? (photoUrl ? photoOutline(photoRatio) : []);
  const [distance, setDistance] = useState(
    initial && !initial.capture.estimatedScale
      ? initial.capture.distance.toString()
      : "",
  );
  const [depth, setDepth] = useState(
    initial?.capture.measuredDepth?.toString() ?? "",
  );
  const sameOutline =
    initial != null &&
    JSON.stringify(initial.capture.corners) === JSON.stringify(corners);
  const [latitude, setLatitude] = useState(
    initial?.capture.location?.latitude.toString() ?? "",
  );
  const [longitude, setLongitude] = useState(
    initial?.capture.location?.longitude.toString() ?? "",
  );
  const [offset, setOffset] = useState(
    initial?.capture.utcOffset.toString() ?? "",
  );
  const [problem, setProblem] = useState("");
  const [locating, setLocating] = useState(false);
  const photoLayout = initial?.photoLayout;
  const [passage, setPassage] = useState<Point[]>(
    photoLayout?.access?.points ?? [],
  );
  const [passageWidth, setPassageWidth] = useState(
    String(photoLayout?.access?.width ?? 1.2),
  );
  const [markingPassage, setMarkingPassage] = useState(false);

  function locate() {
    if (!navigator.geolocation) {
      setProblem(copy.locationFailed);
      return;
    }
    setLocating(true);
    setProblem("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLatitude(coords.latitude.toFixed(6));
        setLongitude(coords.longitude.toFixed(6));
        setOffset(String(-new Date().getTimezoneOffset() / 60));
        setLocating(false);
      },
      () => {
        setLocating(false);
        setProblem(copy.locationFailed);
      },
      { timeout: 10000 },
    );
  }

  return (
    <form
      className="terrain-capture"
      onSubmit={(event) => {
        event.preventDefault();
        if (loadingPhoto) return;
        const estimatedScale = !distance;
        const measuredDistance = estimatedScale ? 10 : Number(distance);
        if (corners.length < 3) {
          setProblem(copy.tooFewCorners);
          return;
        }
        const measuredDepth =
          (sameOutline || photoLayout) && depth ? Number(depth) : undefined;
        const surface = buildSurface(corners, measuredDistance, measuredDepth);
        if (!surface) {
          setProblem(copy.invalidOutline);
          return;
        }

        const controls = new FormData(event.currentTarget);
        const now = new Date();
        const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 10);
        const date = String(controls.get("date") || today);
        if (Boolean(latitude) !== Boolean(longitude)) {
          setProblem(copy.locationIncomplete);
          return;
        }
        const time = String(controls.get("time"));
        const capture: Capture = {
          corners,
          distance: measuredDistance,
          measuredDepth,
          estimatedScale,
          location:
            latitude && longitude
              ? { latitude: Number(latitude), longitude: Number(longitude) }
              : null,
          utcOffset: offset
            ? Number(offset)
            : -new Date(`${date}T${time}`).getTimezoneOffset() / 60,
        };
        const parsedAccess = passage.length
          ? photoAccessSchema.safeParse({
              points: passage,
              width: Number(passageWidth),
            })
          : null;
        const access = parsedAccess?.data;
        const reserved = access && accessFootprint(capture, access);
        if (
          parsedAccess &&
          (!reserved || !footprintFitsSurface(reserved, surface))
        ) {
          setProblem(copy.photoFit.invalidPassage);
          return;
        }
        const alternatives: TerrainDraft["alternatives"] = { a: [], b: [] };
        if (initial && sameOutline) {
          const previousWidth = initial.capture.distance;
          const oldSurface = buildSurface(
            corners,
            previousWidth,
            initial.capture.measuredDepth,
          );
          const previousDepth =
            oldSurface &&
            Math.max(...oldSurface[0][0].map(([, y]) => y)) -
              Math.min(...oldSurface[0][0].map(([, y]) => y));
          const newDepth =
            Math.max(...surface[0][0].map(([, y]) => y)) -
            Math.min(...surface[0][0].map(([, y]) => y));
          const scaleX = measuredDistance / previousWidth;
          const scaleY =
            previousDepth && newDepth ? newDepth / previousDepth : scaleX;
          const resize = ([x, y]: Point): Point => [x * scaleX, y * scaleY];
          for (const key of ["a", "b"] as const) {
            alternatives[key] = initial.alternatives[key].map((element) =>
              element.kind !== "shade_canopy"
                ? { ...element, coordinates: resize(element.coordinates) }
                : {
                    ...element,
                    coordinates: element.coordinates.map((ring) =>
                      ring.map(resize),
                    ),
                  },
            );
          }
        }
        let noFit = photoLayout?.noFit;
        if (
          photoLayout &&
          (!photoLayout.fitted ||
            !sameOutline ||
            initial?.capture.distance !== measuredDistance ||
            initial?.capture.measuredDepth !== measuredDepth ||
            JSON.stringify(photoLayout.access) !== JSON.stringify(access))
        ) {
          const allowed = surfaceWithAccess(surface, reserved);
          const manual = Object.fromEntries((['a', 'b'] as const).map((key) => [
            key,
            alternatives[key].filter((item) => {
              if (isGeneratedPhotoElement(item.id)) return false;
              const footprint = item.kind === "shade_canopy"
                ? item.coordinates[0].slice(0, -1)
                : item.kind === "shade_tree"
                  ? [item.coordinates]
                  : furnitureFootprint(item.kind, item.coordinates, item.dimensionsM);
              return footprintFitsSurface(footprint, allowed);
            }),
          ])) as TerrainDraft["alternatives"];
          const fitted = fitPhotoCovers(surface, reserved, manual);
          noFit = (["a", "b"] as const).filter(
            (key) => fitted[key].length === 0,
          );
          for (const key of ["a", "b"] as const) {
            alternatives[key] = [...fitted[key], ...manual[key]].slice(0, 200);
          }
        }
        onReady({
          example: initial?.example ?? false,
          photoGenerated:
            photoLayout || sameOutline ? initial?.photoGenerated : undefined,
          photoLayout: photoLayout && {
            ...photoLayout,
            generation: 3,
            fitted: true,
            access,
            noFit,
          },
          relief: sameOutline ? initial?.relief : undefined,
          capture,
          date,
          time,
          alternatives,
        });
      }}
    >
      <section aria-labelledby="terrain-plan-title">
        <h2 id="terrain-plan-title">{copy.outline}</h2>
        <p id="terrain-plan-help" className="field-help">
          {markingPassage
            ? copy.photoFit.markHelp
            : photoLayout
              ? photoLayout.detected && sameOutline
                ? copy.photoFit.detected
                : copy.photoFit.verify
              : photoUrl
                ? copy.photoOutlineHelp
                : copy.outlineHelp}
        </p>
        <TerrainOutline
          corners={corners}
          photoUrl={photoUrl}
          onChange={(next) => {
            setCorners(next);
            setProblem("");
          }}
          copy={copy}
          photoDraft={Boolean(photoLayout)}
          access={passage}
          onAccessPoint={
            markingPassage
              ? (point) => {
                  setPassage([...passage, point]);
                  if (passage.length === 1) setMarkingPassage(false);
                  setProblem("");
                }
              : undefined
          }
        />
        {photoUrl && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setCorners([]);
              setMarkingPassage(false);
              setProblem("");
            }}
          >
            {copy.redrawPhoto}
          </button>
        )}
      </section>
      {photoLayout && (
        <fieldset className="terrain-passage-settings">
          <legend>{copy.photoFit.passage}</legend>
          <p className="field-help">{copy.photoFit.passageHelp}</p>
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => {
                setPassage([]);
                setMarkingPassage(true);
                setProblem("");
              }}
            >
              {copy.photoFit.markPassage}
            </button>
            {(passage.length > 0 || markingPassage) && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setPassage([]);
                  setMarkingPassage(false);
                  setProblem("");
                }}
              >
                {copy.photoFit.clearPassage}
              </button>
            )}
          </div>
          {passage.length > 0 && (
            <label className="terrain-field">
              {copy.photoFit.passageWidth}
              <input
                type="number"
                min="0.5"
                max="5"
                step="any"
                required
                value={passageWidth}
                onChange={(event) => setPassageWidth(event.target.value)}
              />
            </label>
          )}
        </fieldset>
      )}
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" className="button button-primary" disabled={loadingPhoto}>
        {loadingPhoto ? copy.photoLoading : copy.design}
      </button>
      <details className="terrain-settings">
        <summary>{copy.settings}</summary>
        <p className="field-help">{copy.settingsHelp}</p>
        <label className="terrain-field">
          {copy.distance}
          <input
            type="number"
            min="1"
            max="500"
            step="any"
            value={distance}
            onChange={(event) => setDistance(event.target.value)}
          />
        </label>
        {(photoLayout || sameOutline) && initial?.photoGenerated && (
          <label className="terrain-field">
            {copy.measuredDepth}
            <input
              type="number"
              min="1"
              max="500"
              step="any"
              value={depth}
              onChange={(event) => setDepth(event.target.value)}
            />
          </label>
        )}
        <section aria-labelledby="terrain-solar-title">
          <h2 id="terrain-solar-title">{copy.sunLocation}</h2>
          <p className="field-help">{copy.sunLocationHelp}</p>
          <button
            type="button"
            className="button"
            onClick={locate}
            disabled={locating}
          >
            {locating ? copy.locating : copy.useLocation}
          </button>
          <div className="terrain-fields">
            <label className="terrain-field">
              {copy.latitude}
              <input
                type="number"
                min="-90"
                max="90"
                step="any"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
              />
            </label>
            <label className="terrain-field">
              {copy.longitude}
              <input
                type="number"
                min="-180"
                max="180"
                step="any"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
              />
            </label>
            <label className="terrain-field">
              {copy.offset}
              <input
                type="number"
                min="-12"
                max="14"
                step="any"
                value={offset}
                onChange={(event) => setOffset(event.target.value)}
              />
            </label>
            <label className="terrain-field">
              {copy.date}
              <input type="date" name="date" defaultValue={initial?.date} />
            </label>
            <label className="terrain-field">
              {copy.time}
              <input
                required
                type="time"
                name="time"
                defaultValue={initial?.time ?? "16:00"}
              />
            </label>
          </div>
        </section>
      </details>
    </form>
  );
}
