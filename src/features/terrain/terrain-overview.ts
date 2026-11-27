import type { Point } from "@/lib/schemas/shade-scene";
import type {
  terrainProjector,
  TerrainFraming,
} from "./terrain-perspective-render";

type Project = ReturnType<typeof terrainProjector>;

export type TerrainFocusTarget = {
  id: string;
  label: string;
  glyph: string;
  framing: TerrainFraming;
  outline?: { points: Point[]; closed: boolean };
};

type MarkerGroup = {
  x: number;
  y: number;
  targets: TerrainFocusTarget[];
};

const minimumModelSize = 24;
const markerSpacing = 40;

export function overviewMarkers(
  targets: TerrainFocusTarget[],
  project: Project,
  width: number,
  height: number,
) {
  const groups: MarkerGroup[] = [];
  for (const target of targets) {
    const { points, groundHeight = 0, tallest } = target.framing;
    const corners = points.flatMap(([x, y]) => [
      project([x, y, groundHeight]),
      project([x, y, groundHeight + tallest]),
    ]);
    if (!corners.length || corners.some(([, , depth]) => depth <= 0.05))
      continue;
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    if (Math.max(right - left, bottom - top) >= minimumModelSize) continue;

    const x = (left + right) / 2;
    const y = bottom;
    if (x < 0 || x > width || y < 0 || y > height) continue;
    const group = groups.find(
      (marker) => Math.hypot(marker.x - x, marker.y - y) < markerSpacing,
    );
    if (group) group.targets.push(target);
    else groups.push({ x, y, targets: [target] });
  }
  return groups;
}

export function drawFocusOutline(
  context: CanvasRenderingContext2D,
  target: TerrainFocusTarget,
  project: Project,
  heightAt: (point: Point) => number,
) {
  const { points, closed } = target.outline ?? {
    points: target.framing.points,
    closed: true,
  };
  if (points.length < 2) return;
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const [x, y] = project([...point, heightAt(point) + 0.03]);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  if (closed) context.closePath();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = "#0c4a6e";
  context.lineWidth = 5;
  context.stroke();
  context.strokeStyle = "#bae6fd";
  context.lineWidth = 2.5;
  context.stroke();
  context.restore();
}
