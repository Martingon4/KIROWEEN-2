import {
  projectShadow,
  shadeRings,
  type ShadeSolar,
} from "@/features/compare/shade-geometry";
import {
  reliefCoordinates,
  reliefResolution,
  type PhotoRelief,
} from "./terrain-relief";
import { footprintFitsSurface } from "@/lib/geo/planar";
import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import type { TerrainReference } from "./terrain-context";
import {
  objectFaces,
  type Face,
  type Vertex,
} from "./terrain-perspective-model";

type Project = (point: Vertex) => [x: number, y: number, depth: number];

export type TerrainFraming = {
  points: Point[];
  tallest: number;
  groundHeight?: number;
};

export function terrainCamera(
  scene: ShadeScene,
  angle: number,
  elevation: number,
  relief: boolean,
  framing?: TerrainFraming,
) {
  const vertices = framing?.points ?? scene.surface.flat(2);
  const xs = vertices.map(([x]) => x);
  const ys = vertices.map(([, y]) => y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const extent = Math.max(
    ...vertices.map(([x, y]) => Math.hypot(x - centerX, y - centerY)),
  );
  const east = Math.cos((angle * Math.PI) / 180);
  const north = Math.sin((angle * Math.PI) / 180);
  if (framing?.groundHeight !== undefined) {
    const halfHeight = framing.tallest / 2;
    const target = framing.groundHeight + halfHeight;
    const pitch = 0.13 + elevation * 0.61;
    // Frame the enclosing sphere so the object still fits when the camera turns.
    const range = Math.max(0.22, Math.hypot(extent, halfHeight)) * 2.9;
    return {
      centerX,
      centerY,
      east,
      north,
      target,
      distance: range * Math.cos(pitch),
      eye: target + range * Math.sin(pitch),
    };
  }
  const radius = Math.max(2, extent);
  const tallest =
    (framing?.tallest ??
      Math.max(0, ...scene.elements.map(({ heightM }) => heightM))) +
    (relief ? Math.min(4, radius * 0.3) : 0);
  const distance = Math.max(radius * 2.2, tallest * 1.65, 7);
  const eye = 1.65 + (radius * 0.95 + 0.55) * elevation;
  const lowTarget = Math.max(0.8, tallest * 0.42);
  const highTarget = Math.min(1.2, tallest * 0.15);
  const target = lowTarget + (highTarget - lowTarget) * elevation;
  return { centerX, centerY, distance, eye, target, east, north };
}

export function terrainProjector(
  scene: ShadeScene,
  angle: number,
  elevation: number,
  zoom: number,
  relief: boolean,
  width: number,
  height: number,
  framing?: TerrainFraming,
  webgl = false,
): Project {
  const { centerX, centerY, distance, eye, target, east, north } =
    terrainCamera(scene, angle, elevation, relief, framing);
  const pitch = Math.atan2(eye - target, distance);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const focal = height * 0.98 * zoom;

  return ([x, y, z]) => {
    const dx = x - centerX;
    const dy = y - centerY;
    const horizontal = distance - dx * east - dy * north;
    const vertical = z - eye;
    const depth = horizontal * cosPitch - vertical * sinPitch;
    // A close schematic view uses an orthographic projection so distant
    // terrain corners behind the camera do not invert through the frame.
    const scale =
      webgl || framing?.groundHeight === undefined
        ? focal / depth
        : focal / Math.hypot(distance, eye - target);
    return [
      width / 2 + (-dx * north + dy * east) * scale,
      height * (webgl ? 0.5 : 0.52) -
        (vertical * cosPitch + horizontal * sinPitch) * scale,
      depth,
    ];
  };
}

function polygon(
  context: CanvasRenderingContext2D,
  points: readonly (readonly number[])[],
) {
  const [start, ...rest] = points;
  context.moveTo(start[0], start[1]);
  rest.forEach(([x, y]) => context.lineTo(x, y));
  context.closePath();
}

function clipShadow(ring: Point[], limits: [number, number, number, number]) {
  // Clip to the site's world-space bounds before perspective projection.
  for (let side = 0; side < limits.length && ring.length; side++) {
    const axis = side % 2;
    const limit = limits[side];
    const inside = (point: Point) =>
      side < 2 ? point[axis] >= limit : point[axis] <= limit;
    const clipped: Point[] = [];
    ring.forEach((point, index) => {
      const last = ring[(index + ring.length - 1) % ring.length];
      if (inside(point) !== inside(last)) {
        const fraction = (limit - last[axis]) / (point[axis] - last[axis]);
        clipped.push([
          last[0] + (point[0] - last[0]) * fraction,
          last[1] + (point[1] - last[1]) * fraction,
        ]);
      }
      if (inside(point)) clipped.push(point);
    });
    ring = clipped;
  }
  return ring;
}

function faceColor({ vertices: [a, b, c], material }: Face, light: Vertex) {
  const u = b.map((value, i) => value - a[i]);
  const v = c.map((value, i) => value - a[i]);
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(...normal);
  const diffuse = length
    ? Math.max(
        0,
        normal.reduce((dot, axis, i) => dot + axis * light[i], 0) / length,
      )
    : 0;
  const level = 0.58 + diffuse * 0.45;
  return `rgb(${material.map((channel) => Math.min(255, Math.round(channel * level))).join(",")})`;
}

function drawFaces(
  context: CanvasRenderingContext2D,
  faces: Face[],
  project: Project,
  light: Vertex,
) {
  const visibleFaces = faces
    .flatMap((face) => {
      const points = face.vertices.map(project);
      const area = points.reduce((sum, [x, y], i) => {
        const [nx, ny] = points[(i + 1) % points.length];
        return sum + x * ny - y * nx;
      }, 0);
      return area < 0
        ? [
            {
              face,
              points,
              depth:
                points.reduce((sum, point) => sum + point[2], 0) /
                points.length,
            },
          ]
        : [];
    })
    .sort((a, b) => b.depth - a.depth);
  for (const { face, points } of visibleFaces) {
    context.beginPath();
    polygon(context, points);
    context.fillStyle = faceColor(face, light);
    context.fill();
    context.strokeStyle = context.fillStyle;
    context.lineWidth = 0.65;
    context.stroke();
  }
}

export function renderObjectThumbnail(
  context: CanvasRenderingContext2D,
  faces: Face[],
) {
  const view: Project = ([x, y, z]) => [
    0.83 * x + 0.55 * y,
    0.3 * x - 0.45 * y - 0.83 * z,
    0.55 * x - 0.83 * y - 0.4 * z,
  ];
  const vertices = faces.flatMap((face) => face.vertices.map(view));
  const xs = vertices.map(([x]) => x);
  const ys = vertices.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const { width, height } = context.canvas;
  const scale = Math.min(
    (width - 36) / (right - left),
    (height - 16) / (bottom - top),
  );
  context.clearRect(0, 0, width, height);
  drawFaces(
    context,
    faces,
    (point) => {
      const [x, y, depth] = view(point);
      return [
        width / 2 + (x - (left + right) / 2) * scale,
        height / 2 + (y - (top + bottom) / 2) * scale,
        depth,
      ];
    },
    [0.3, -0.4, 0.86],
  );
}

export function renderTerrainPerspective(
  context: CanvasRenderingContext2D,
  scene: ShadeScene,
  solar: ShadeSolar | null,
  angle: number,
  elevation: number,
  zoom: number,
  relief: PhotoRelief | undefined,
  faces: Face[],
  reference?: TerrainReference,
  framing?: TerrainFraming,
) {
  const { width, height } = context.canvas;
  const light: Vertex = solar
    ? [
        Math.sin(solar.azimuthRad) * Math.cos(solar.elevationRad),
        Math.cos(solar.azimuthRad) * Math.cos(solar.elevationRad),
        Math.sin(solar.elevationRad),
      ]
    : [0.3, -0.4, 0.86];
  const project = terrainProjector(
    scene,
    angle,
    elevation,
    zoom,
    Boolean(relief),
    width,
    height,
    framing,
  );
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#d2e3ee");
  gradient.addColorStop(0.45, "#edf3f4");
  gradient.addColorStop(0.7, "#e7e6dd");
  gradient.addColorStop(1, "#cad1c5");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  if (reference) drawFaces(context, reference.faces, project, light);

  function terrain(level: number) {
    context.beginPath();
    for (const ring of scene.surface.flat(1)) {
      polygon(
        context,
        ring.map(([x, y]) => project([x, y, level])),
      );
    }
  }

  terrain(-0.1);
  context.fillStyle = "#8d8d77";
  context.fill("evenodd");
  terrain(0);
  context.fillStyle = "#d3c9af";
  context.fill("evenodd");
  context.save();
  context.clip("evenodd");
  if (solar && !relief) {
    const ground = scene.surface.flat(2);
    const east = ground.map(([x]) => x);
    const north = ground.map(([, y]) => y);
    const bounds: [number, number, number, number] = [
      Math.min(...east),
      Math.min(...north),
      Math.max(...east),
      Math.max(...north),
    ];
    context.beginPath();
    for (const element of scene.elements) {
      for (const ring of projectShadow(
        shadeRings(element),
        element.heightM,
        solar,
      )) {
        const clipped = clipShadow(ring, bounds);
        if (clipped.length > 2)
          polygon(
            context,
            clipped.map(([x, y]) => project([x, y, 0])),
          );
      }
    }
    context.fillStyle = "rgba(31, 43, 52, 0.31)";
    context.fill();
  }
  context.restore();

  drawFaces(context, faces, project, light);
}

export function sceneFaces(
  scene: ShadeScene,
  relief: PhotoRelief | undefined,
  solar: ShadeSolar | null,
  proceduralElements = scene.elements,
): Face[] {
  if (!relief)
    return proceduralElements.flatMap((element) => objectFaces(element));
  const { vertex, elevation } = reliefCoordinates(scene.surface, relief);
  const outline = scene.surface[0][0].slice(0, -1);
  const clipRelief =
    outline.length !== 4 ||
    outline.some(([x, y], i) => {
      const [u, v] = outline[(i + 1) % outline.length];
      return x !== u && y !== v;
    });
  const fits = (vertices: Vertex[]) =>
    !clipRelief ||
    footprintFitsSurface(vertices.map(([x, y]): Point => [x, y]), scene.surface);
  const faces = proceduralElements.flatMap((element) =>
    objectFaces(element, elevation),
  );
  const shadows = solar
    ? scene.elements.flatMap((element): ShadeScene["surface"] => {
        const rings = shadeRings(element);
        if (!rings.length) return [];
        return [
          projectShadow(rings, element.heightM, solar).map((ring) => [
            ...ring,
            ring[0],
          ]),
        ];
      })
    : [];
  const last = reliefResolution - 1;
  for (let row = 0; row < last; row++) {
    for (let col = 0; col < last; col++) {
      const a = vertex(row, col);
      const b = vertex(row + 1, col);
      const c = vertex(row + 1, col + 1);
      const d = vertex(row, col + 1);
      const center: Point = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const inShade = shadows.some((shadow) =>
        footprintFitsSurface([center], [shadow]),
      );
      const color = relief.samples[row * reliefResolution + col].color;
      const material: Face["material"] = [
        color[0] * (inShade ? 0.7 : 1),
        color[1] * (inShade ? 0.7 : 1),
        color[2] * (inShade ? 0.7 : 1),
      ];
      for (const vertices of [[a, b, c], [a, c, d]]) {
        if (fits(vertices)) faces.push({ vertices, material });
      }
    }
  }
  for (let i = 0; i < last; i++) {
    for (const [a, b] of [
      [vertex(0, i + 1), vertex(0, i)],
      [vertex(last, i), vertex(last, i + 1)],
      [vertex(i, 0), vertex(i + 1, 0)],
      [vertex(i + 1, last), vertex(i, last)],
    ]) {
      if (clipRelief || a[2] + b[2] <= 0.01) continue;
      faces.push({
        vertices: [[a[0], a[1], 0], [b[0], b[1], 0], b, a],
        material: [153, 137, 112],
      });
    }
  }
  return faces;
}
