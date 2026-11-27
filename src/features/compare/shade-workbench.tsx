"use client";

import { footprintFitsSurface } from "@/lib/geo/planar";
import { useRef, useState, type ReactNode } from "react";
import type es from "@/messages/es.json";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import {
  terrainObjectKinds,
  terrainObjectGroups,
  terrainDimensions,
  terrainObjects,
} from "@/lib/schemas/terrain-objects";
import { groundPointAt, ShadeSceneView } from "./shade-scene-view";
import {
  furnitureFootprint,
  objectsOverlap,
  rectangle,
} from "./shade-geometry";

type Element = ShadeScene["elements"][number];

const groups = {
  ...terrainObjectGroups,
  shade: ["shade_tree", "shade_canopy", ...terrainObjectGroups.shade],
} satisfies Record<keyof typeof es.terrain.placement.groups, Element["kind"][]>;
type PaletteGroup = keyof typeof groups;

function elementCenter(element: Element): Point {
  if (element.kind !== "shade_canopy") return element.coordinates;
  const ring = element.coordinates[0].slice(0, -1);
  return [
    ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
    ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
  ];
}

function footprintOf(element: Element): Point[] {
  if (element.kind === "shade_tree") return [element.coordinates];
  if (element.kind === "shade_canopy")
    return element.coordinates[0].slice(0, -1);
  return furnitureFootprint(element.kind, element.coordinates, element.dimensionsM);
}

function moveTo(element: Element, point: Point): Element {
  if (element.kind !== "shade_canopy")
    return { ...element, coordinates: point };
  const [x, y] = elementCenter(element);
  return {
    ...element,
    coordinates: element.coordinates.map((ring) =>
      ring.map(([u, v]): Point => [u + point[0] - x, v + point[1] - y]),
    ),
  };
}

export function ShadeWorkbench({
  scene,
  solar,
  copy,
  caption,
  savedArea,
  canopySize = 6,
  compact = false,
  preview,
  onElementsChange,
  terrain,
  locale,
  renderThumbnail,
  onReview,
  reserved,
}: {
  scene: ShadeScene;
  solar: { azimuthRad: number; elevationRad: number } | null;
  copy: typeof es.compare.shadeScene;
  caption: string;
  savedArea: string;
  canopySize?: number;
  compact?: boolean;
  preview?: ReactNode;
  onElementsChange?: (elements: Element[]) => void;
  terrain?: Pick<typeof es.terrain, "furniture" | "placement">;
  locale?: "es" | "en";
  renderThumbnail?: (kind: Element["kind"]) => ReactNode;
  onReview?: () => void;
  reserved?: Point[];
}) {
  const [draftElements, setDraftElements] = useState(scene.elements);
  const elements = onElementsChange ? scene.elements : draftElements;
  function setElements(update: (elements: Element[]) => Element[]) {
    if (onElementsChange) onElementsChange(update(elements));
    else setDraftElements(update);
  }
  const [kind, setKind] = useState<Element["kind"]>("shade_tree");
  const [group, setGroup] = useState<"all" | PaletteGroup>("all");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const moving = elements.find(({ id }) => id === movingId);
  const palette: Element["kind"][] =
    group === "all"
      ? ["shade_tree", "shade_canopy", ...(terrain ? terrainObjectKinds : [])]
      : groups[group];
  const labels: Partial<Record<Element["kind"], string>> = {
    shade_tree: copy.edit.tree,
    shade_canopy: copy.edit.canopy,
    ...terrain?.furniture,
  };
  const [location, setLocation] = useState<Point>([0, 0]);
  const [error, setError] = useState<"outside" | "limit" | "occupied" | "reserved" | null>(
    null,
  );
  const figure = useRef<HTMLElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const vertices = scene.surface.flat(2);
  const east = vertices.map(([x]) => x);
  const north = vertices.map(([, y]) => y);
  const min: Point = [Math.min(...east), Math.min(...north)];
  const max: Point = [Math.max(...east), Math.max(...north)];
  const center: Point = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  const step = Math.min(3, (max[0] - min[0]) / 20, (max[1] - min[1]) / 20);
  const marker: Point = [center[0] + location[0], center[1] + location[1]];
  function pointAt(clientX: number, clientY: number) {
    const ground = figure.current?.querySelector<SVGPathElement>(
      ".shade-scene-ground",
    );
    return ground
      ? groundPointAt(
          ground,
          scene.surface[0][0][0],
          clientX,
          clientY,
          Boolean(terrain),
        )
      : null;
  }
  function moveMarker([x, y]: Point) {
    setLocation([x - center[0], y - center[1]]);
    setError(null);
    setFeedback("");
  }
  function placeElement(element: Element) {
    setFeedback("");
    const footprint = footprintOf(element);
    if (!footprintFitsSurface(footprint, scene.surface)) {
      setError("outside");
      return;
    }
    if (reserved && !footprintFitsSurface(footprint, [
      [...scene.surface[0], [...reserved, reserved[0]]], ...scene.surface.slice(1),
    ])) {
      setError("reserved");
      return;
    }
    if (
      terrain &&
      elements.some(
        (item) => item.id !== element.id && objectsOverlap(element, item),
      )
    ) {
      setError("occupied");
      return;
    }
    const relocated = elements.some(({ id }) => id === element.id);
    setElements((current) =>
      relocated
        ? current.map((item) => (item.id === element.id ? element : item))
        : [...current, element],
    );
    setMovingId(null);
    setError(null);
    if (terrain)
      setFeedback(
        (relocated ? terrain.placement.moved : terrain.placement.added).replace(
          "{object}",
          labels[element.kind] ?? "",
        ),
      );
  }
  function addElement(kind: Element["kind"], point: Point) {
    if (elements.length >= 200) {
      setError("limit");
      return;
    }
    const id = crypto.randomUUID();
    if (kind === "shade_tree") {
      placeElement({
        id,
        kind,
        heightM: 6,
        canopyDiameterM: 5,
        coordinates: point,
      });
    } else if (kind === "shade_canopy") {
      const corners = rectangle(point, canopySize / 2);
      placeElement({
        id,
        kind,
        heightM: 4,
        coordinates: [[...corners, corners[0]]],
      });
    } else {
      placeElement({
        id,
        kind,
        heightM: terrainObjects[kind].height,
        coordinates: point,
      });
    }
  }
  function placeAtMarker() {
    if (!moving) return addElement(kind, marker);
    placeElement(moveTo(moving, marker));
  }

  const placementOutline = moving
    ? footprintOf(moveTo(moving, marker))
    : kind === "shade_tree"
      ? [marker]
      : kind === "shade_canopy"
        ? rectangle(marker, canopySize / 2)
        : furnitureFootprint(kind, marker);
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  function dimensions(objectKind: Element["kind"]) {
    if (objectKind === "shade_tree") return terrain?.placement.treeSize;
    const { width, depth } =
      objectKind === "shade_canopy"
        ? { width: canopySize, depth: canopySize }
        : terrainDimensions(objectKind, moving?.kind === objectKind ? moving.dimensionsM : undefined);
    return terrain?.placement.dimensions
      .replace("{width}", format.format(width))
      .replace("{depth}", format.format(depth));
  }

  const placementActions = (
    <>
      <button
        ref={addButton}
        type="button"
        className="button button-primary"
        onClick={placeAtMarker}
        onKeyDown={(event) => {
          const offsets: Record<string, Point> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          if (!Object.hasOwn(offsets, event.key)) return;
          event.preventDefault();
          const [x, y] = offsets[event.key];
          moveMarker([
            Math.max(min[0], Math.min(max[0], marker[0] + x)),
            Math.max(min[1], Math.min(max[1], marker[1] + y)),
          ]);
        }}
      >
        {moving ? terrain?.placement.confirmMove : copy.edit.add}
      </button>
      {moving && (
        <button
          type="button"
          className="button"
          onClick={() => {
            setMovingId(null);
            setError(null);
          }}
        >
          {terrain?.placement.cancelMove}
        </button>
      )}
    </>
  );

  return (
    <div
      className={
        terrain
          ? `terrain-workbench${preview ? " terrain-workbench-preview" : ""}`
          : undefined
      }
    >
      {!preview && (
        <div className={terrain ? "terrain-catalog" : undefined}>
          <h3>{terrain?.placement.catalog ?? copy.edit.title}</h3>
          {!terrain && <p className="field-help">{copy.edit.help}</p>}
          {terrain && (
            <label className="terrain-field terrain-palette-filter">
              {terrain.placement.filter}
              <select
                value={group}
                onChange={(event) => {
                  const next = event.currentTarget.value as typeof group;
                  setGroup(next);
                  const matching: Element["kind"][] =
                    next === "all" ? palette : groups[next];
                  if (next !== "all" && !matching.includes(kind))
                    setKind(matching[0]);
                }}
              >
                <option value="all">{terrain.placement.all}</option>
                {Object.entries(terrain.placement.groups).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            className={
              terrain ? "terrain-catalog-tiles" : "shade-scene-controls"
            }
          >
            {palette.map((objectKind) => (
              <button
                key={objectKind}
                type="button"
                className="button shade-object-source"
                aria-pressed={!moving && kind === objectKind}
                aria-label={terrain ? labels[objectKind] : undefined}
                onClick={(event) => {
                  setKind(objectKind);
                  setMovingId(null);
                  if (event.detail === 0) {
                    setFeedback("");
                    setError(null);
                  }
                }}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    moved: false,
                  };
                  setKind(objectKind);
                  setMovingId(null);
                  setError(null);
                  setFeedback("");
                }}
                onPointerMove={(event) => {
                  const active = drag.current;
                  if (active?.id !== event.pointerId) return;
                  active.moved ||=
                    Math.hypot(
                      event.clientX - active.x,
                      event.clientY - active.y,
                    ) > 6;
                  if (!active.moved) return;
                  const point = pointAt(event.clientX, event.clientY);
                  if (point) moveMarker(point);
                }}
                onPointerUp={(event) => {
                  const active = drag.current;
                  if (active?.id !== event.pointerId) return;
                  drag.current = null;
                  if (!active.moved) return;
                  const point = pointAt(event.clientX, event.clientY);
                  if (point) addElement(objectKind, point);
                  else setError("outside");
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                }}
              >
                {terrain ? (
                  <>
                    {renderThumbnail?.(objectKind)}
                    <span>{labels[objectKind]}</span>
                    {dimensions(objectKind) && (
                      <small>{dimensions(objectKind)}</small>
                    )}
                  </>
                ) : (
                  labels[objectKind]
                )}
              </button>
            ))}
            {!terrain && placementActions}
          </div>
        </div>
      )}
      <div className={terrain ? "terrain-stage" : undefined}>
        {terrain && !preview && (
          <div className="terrain-stage-heading">
            <div>
              <h3>{terrain.placement.planTitle}</h3>
              <p className="terrain-selection">
                {terrain.placement.selected}{" "}
                <strong>{labels[moving?.kind ?? kind]}</strong>
                {dimensions(moving?.kind ?? kind) && (
                  <span>{dimensions(moving?.kind ?? kind)}</span>
                )}
              </p>
            </div>
            <div className="terrain-placement-actions">{placementActions}</div>
            <p className="field-help">
              {moving ? terrain.placement.moveHelp : copy.edit.help}
            </p>
          </div>
        )}
        <figure ref={figure} className="shade-scene-figure">
          {preview ?? (
            <ShadeSceneView
              scene={{ ...scene, elements }}
              solar={solar}
              label={copy.graphic}
              marker={marker}
              compact={compact}
              showObjectNumbers={Boolean(terrain)}
              plan={Boolean(terrain)}
              placementOutline={terrain ? placementOutline : undefined}
              reserved={reserved}
              onPlace={moveMarker}
            />
          )}
          <figcaption>
            <strong>{caption}</strong>
            <span>{savedArea}</span>
            <span>{elements.length === 0 ? copy.empty : copy.legend}</span>
          </figcaption>
        </figure>
        {error && (
          <p role="alert">
            {error === "occupied" || error === "reserved"
              ? terrain?.placement[error]
              : copy.edit[error]}
          </p>
        )}
        {terrain && !preview && (
          <div className="terrain-stage-footer">
            <p className="terrain-placement-feedback" role="status">
              {feedback}
            </p>
            {elements.length > 0 && onReview && (
              <button type="button" className="button" onClick={onReview}>
                {terrain.placement.review}
              </button>
            )}
          </div>
        )}
      </div>
      <div className={terrain ? "terrain-roster" : undefined}>
        {terrain && (
          <h3>
            {terrain.placement.listTitle} <span>{elements.length}</span>
          </h3>
        )}
        <ul className="shade-object-list">
          {elements.map((element, index) => {
            const name = `${index + 1}. ${labels[element.kind]}`;
            const furniture =
              element.kind === "bench" || element.kind === "planter";
            const fixture =
              element.kind !== "shade_tree" && element.kind !== "shade_canopy";
            const minHeight = fixture ? 0.3 : 1;
            const maxHeight = furniture ? 3 : fixture ? 8 : 30;
            return (
              <li key={element.id} className="shade-scene-controls">
                <strong>{name}</strong>
                <label>
                  {copy.edit.height}
                  <input
                    type="number"
                    aria-label={`${name} · ${copy.edit.height}`}
                    min={minHeight}
                    max={maxHeight}
                    step={fixture ? "0.05" : "0.5"}
                    key={element.id}
                    defaultValue={element.heightM}
                    onChange={(event) => {
                      const heightM = event.target.valueAsNumber;
                      if (heightM >= minHeight && heightM <= maxHeight) {
                        setElements((current) =>
                          current.map((item) =>
                            item.id === element.id
                              ? { ...item, heightM }
                              : item,
                          ),
                        );
                      }
                    }}
                  />
                </label>
                {terrain && !preview && (
                  <button
                    type="button"
                    className="button"
                    aria-label={`${terrain.placement.move} ${name}`}
                    onClick={() => {
                      setMovingId(element.id);
                      moveMarker(elementCenter(element));
                      addButton.current?.focus();
                    }}
                  >
                    {terrain.placement.move}
                  </button>
                )}
                <button
                  type="button"
                  className="button"
                  aria-label={`${copy.edit.remove} ${name}`}
                  onClick={() =>
                    setElements((current) =>
                      current.filter((item) => item.id !== element.id),
                    )
                  }
                >
                  {copy.edit.remove}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
