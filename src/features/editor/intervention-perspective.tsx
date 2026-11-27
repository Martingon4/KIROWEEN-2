"use client";

import { useMemo } from "react";
import { TerrainPerspective } from "@/features/terrain/terrain-perspective";
import type { TerrainFocusTarget } from "@/features/terrain/terrain-overview";
import { pilotContextWays, projectContext } from "@/features/terrain/terrain-context";
import type { OsmContext } from "@/features/places/site-data";
import { rectangle } from "@/features/compare/shade-geometry";
import {
  beam,
  prism,
  type Face,
} from "@/features/terrain/terrain-perspective-model";
import type { DrawableGeometry } from "@/lib/geo/project";
import type { Intervention } from "@/lib/schemas/intervention";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import { footprintFitsSurface } from "@/lib/geo/planar";
import { urbanObjectCenter } from "@/lib/geo/urban-object";
import type { ModelPlacement } from "@/features/terrain/terrain-orbit-webgl";
import type es from "@/messages/es.json";

function marketStalls(
  ring: Point[],
  count: number,
  moduleM2: number,
): ModelPlacement[] {
  const ratio = 2.52 / 1.36;
  const width = Math.sqrt(moduleM2 * ratio);
  const depth = moduleM2 / width;
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const surface: ShadeScene["surface"] = [[ring]];
  const gap = 0.3;
  const stalls: ModelPlacement[] = [];
  for (let y = minY + depth / 2 + gap; y + depth / 2 < maxY; y += depth + gap) {
    for (
      let x = minX + width / 2 + gap;
      x + width / 2 < maxX;
      x += width + gap
    ) {
      const footprint: Point[] = [
        [x - width / 2, y - depth / 2],
        [x + width / 2, y - depth / 2],
        [x + width / 2, y + depth / 2],
        [x - width / 2, y + depth / 2],
      ];
      if (!footprintFitsSurface(footprint, surface)) continue;
      stalls.push({ kind: "stall", point: [x, y], width, depth, height: 2.53 });
      if (stalls.length === count) return stalls;
    }
  }
  return stalls;
}

export function InterventionPerspective({
  boundary,
  center,
  features,
  copy,
  initialFocusId,
  pilotContext,
}: {
  boundary: Extract<DrawableGeometry, { type: "Polygon" }>;
  center: Point;
  features: readonly Intervention[];
  copy: typeof es.terrain.perspective;
  initialFocusId?: string;
  pilotContext: OsmContext;
}) {
  const {
    scene,
    additionalFaces,
    placements,
    requestedStalls,
    focusLabels,
    additionalFocus,
    reference,
  } = useMemo(() => {
    const northScale = 111_195;
    const eastScale = northScale * Math.cos((center[1] * Math.PI) / 180);
    const project = ([longitude, latitude]: readonly [
      number,
      number,
    ]): Point => [
      (longitude - center[0]) * eastScale,
      (latitude - center[1]) * northScale,
    ];
    const scene: ShadeScene = {
      surface: [boundary.coordinates.map((ring) => ring.map(project))],
      elements: [],
    };
    const additionalFaces: Face[] = [];
    const placements: ModelPlacement[] = [];
    const additionalFocus: TerrainFocusTarget[] = [];
    const focusLabels = Object.fromEntries(
      features.map(({ id, properties }) => [id, properties.label]),
    );
    let requestedStalls = 0;
    for (const { id, kind, geometry, properties } of features) {
      switch (kind) {
        case "urban_object":
          scene.elements.push({
            id,
            kind: properties.objectType,
            heightM: properties.heightM,
            coordinates: project(urbanObjectCenter(geometry.coordinates[0])),
          });
          break;
        case "shade_tree":
          scene.elements.push({
            id,
            kind,
            heightM: properties.heightM,
            canopyDiameterM: properties.canopyDiameterM,
            coordinates: project(geometry.coordinates),
          });
          break;
        case "shade_canopy":
          scene.elements.push({
            id,
            kind,
            heightM: properties.heightM,
            coordinates: geometry.coordinates.map((ring) => ring.map(project)),
          });
          break;
        case "temporary_market": {
          const ring = geometry.coordinates[0].map(project);
          const outline = ring.slice(0, -1);
          const area = outline.reduce((sum, [x, y], i) => {
            const [nextX, nextY] = outline[(i + 1) % outline.length];
            return sum + x * nextY - y * nextX;
          }, 0);
          if (area < 0) outline.reverse();
          additionalFaces.push(
            ...prism(outline, -0.012, 0.005, [218, 169, 111]),
          );
          requestedStalls += properties.stallCount;
          placements.push(
            ...marketStalls(ring, properties.stallCount, properties.moduleM2),
          );
          additionalFocus.push({
            id,
            label: properties.label,
            glyph: "▥",
            framing: { points: outline, tallest: 2.53, groundHeight: 0 },
          });
          break;
        }
        case "proposed_crossing": {
          const route = geometry.coordinates.map(project);
          for (let i = 1; i < route.length; i++) {
            additionalFaces.push(
              ...beam(
                route[i - 1],
                route[i],
                properties.widthM,
                0,
                0.04,
                [239, 239, 225],
              ),
            );
          }
          additionalFocus.push({
            id,
            label: properties.label,
            glyph: "≋",
            outline: { points: route, closed: false },
            framing: {
              points: route.flatMap((point) =>
                rectangle(point, properties.widthM / 2),
              ),
              tallest: 0.04,
              groundHeight: 0,
            },
          });
          break;
        }
      }
    }
    const location = { longitude: center[0], latitude: center[1] };
    const reference = projectContext(
      pilotContextWays(pilotContext, location),
      location,
      scene.surface,
      [0, 0],
    );
    return {
      scene,
      additionalFaces,
      placements,
      requestedStalls,
      focusLabels,
      additionalFocus,
      reference,
    };
  }, [boundary, center, features, pilotContext]);

  return (
    <>
      <TerrainPerspective
        scene={scene}
        solar={null}
        copy={copy}
        additionalFaces={additionalFaces}
        placements={placements}
        requestedStalls={requestedStalls}
        focusLabels={focusLabels}
        additionalFocus={additionalFocus}
        initialFocusId={initialFocusId}
        reference={reference ?? undefined}
        frameReference={false}
        initiallyElevated
      />
      {reference && (
        <p className="field-help editor-preview-help">
          {copy.pilotContext}{" "}
          <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>
        </p>
      )}
    </>
  );
}
