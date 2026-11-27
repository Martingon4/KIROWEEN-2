"use client";

import { useEffect, useRef } from "react";
import { rectangle } from "@/features/compare/shade-geometry";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import { terrainObjects } from "@/lib/schemas/terrain-objects";
import { objectFaces } from "./terrain-perspective-model";
import { renderObjectThumbnail } from "./terrain-perspective-render";

type Kind = ShadeScene["elements"][number]["kind"];

export function TerrainObjectThumbnail({ kind }: { kind: Kind }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const id = "preview";
    const center: Point = [0, 0];
    const roof = rectangle(center, 1.5);
    const element: ShadeScene["elements"][number] =
      kind === "shade_tree"
        ? { id, kind, coordinates: center, heightM: 6, canopyDiameterM: 5 }
        : kind === "shade_canopy"
          ? { id, kind, coordinates: [[...roof, roof[0]]], heightM: 4 }
          : {
              id,
              kind,
              coordinates: center,
              heightM: terrainObjects[kind].height,
            };
    renderObjectThumbnail(context, objectFaces(element));
  }, [kind]);

  return <canvas ref={canvas} width={160} height={86} aria-hidden="true" />;
}
