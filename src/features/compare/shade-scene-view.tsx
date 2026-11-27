import type { Point, ShadeScene } from "@/lib/schemas/shade-scene";
import {
  furnitureFootprint,
  canopySupports,
  projectShadow,
  shadeRings,
  type ShadeSolar,
} from "./shade-geometry";

export function groundPointAt(
  ground: SVGPathElement,
  origin: Point,
  clientX: number,
  clientY: number,
  plan = false,
): Point | null {
  const matrix = ground.getScreenCTM();
  if (!matrix) return null;
  const position = new DOMPoint(clientX, clientY).matrixTransform(
    matrix.inverse(),
  );
  if (!ground.isPointInFill(position)) return null;
  if (plan) return [origin[0] + position.x, origin[1] - position.y];
  const y = -position.y / 0.56;
  return [
    origin[0] + position.x * 0.96 + y * 0.28,
    origin[1] - position.x * 0.28 + y * 0.96,
  ];
}

export function ShadeSceneView({
  scene,
  solar,
  label,
  onPlace,
  marker,
  compact = false,
  showObjectNumbers = false,
  plan = false,
  placementOutline,
  reserved,
}: {
  scene: ShadeScene;
  solar: ShadeSolar | null;
  label: string;
  onPlace: (point: Point) => void;
  marker: Point;
  compact?: boolean;
  showObjectNumbers?: boolean;
  plan?: boolean;
  placementOutline?: Point[];
  reserved?: Point[];
}) {
  const origin = scene.surface[0][0][0];
  // Rotate the metric ground plane, then tilt the view around its horizontal axis.
  function project([east, north]: Point, height = 0): Point {
    const x = east - origin[0];
    const y = north - origin[1];
    if (plan) return [x, -y];
    return [x * 0.96 - y * 0.28, -(x * 0.28 + y * 0.96) * 0.56 - height * 0.83];
  }
  function path(rings: Point[][], height = 0) {
    return rings
      .map(
        (vertices) =>
          `M ${vertices.map((vertex) => project(vertex, height).join(",")).join(" L ")} Z`,
      )
      .join(" ");
  }

  const ground = scene.surface.flat(1);
  const projected = ground.flatMap((vertices) =>
    vertices.map((vertex) => project(vertex)),
  );
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const left = Math.min(...xs) - (compact ? 3 : 12);
  const right = Math.max(...xs) + (compact ? 3 : 12);
  const maxHeight = Math.max(
    0,
    ...scene.elements.map((element) => element.heightM),
  );
  const ceiling = plan ? 3 : compact ? Math.max(9, maxHeight * 0.83 + 2) : 32;
  const top = Math.min(...ys) - ceiling;
  const bottom = Math.max(...ys) + (compact ? 4 : 17);
  const hatch = compact ? 0.9 : 2.6;
  const symbol = Math.max(0.52, (right - left) / 57);
  const groundPath = path(ground);
  const elements = scene.elements
    .map((element, index) => {
      const height = element.heightM;
      const isTree = element.kind === "shade_tree";
      const furniture =
        element.kind !== "shade_tree" && element.kind !== "shade_canopy";
      const rings = furniture
        ? [furnitureFootprint(element.kind, element.coordinates, element.dimensionsM)]
        : shadeRings(element);
      const outer = rings[0];
      const corners =
        furniture || plan
          ? []
          : isTree
            ? [element.coordinates]
            : canopySupports(outer.slice(0, -1));
      const outline =
        element.kind === "shade_canopy" ? outer.slice(0, -1) : outer;
      const center: Point = [
        outline.reduce((sum, point) => sum + point[0], 0) / outline.length,
        outline.reduce((sum, point) => sum + point[1], 0) / outline.length,
      ];
      const shade = shadeRings(element);
      return {
        id: element.id,
        number: index + 1,
        label: project(center, height),
        isTree,
        furniture,
        depth:
          outer.reduce((sum, vertex) => sum + project(vertex)[1], 0) /
          outer.length,
        roof: path(rings, height),
        shadow:
          solar && shade.length
            ? path(projectShadow(shade, height, solar))
            : "",
        supports: corners.map((vertex) => ({
          base: project(vertex),
          top: project(vertex, height),
        })),
      };
    })
    .sort((a, b) => a.depth - b.depth);

  return (
    <svg
      className={plan ? "shade-scene terrain-plan-view" : "shade-scene"}
      viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <clipPath id="shade-scene-surface">
          <path d={groundPath} clipRule="evenodd" />
        </clipPath>
        <pattern
          id="shade-scene-hatch"
          width={hatch}
          height={hatch}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <rect width={hatch} height={hatch} fill="#94a3b8" />
          <path
            d={`M0 0 V${hatch}`}
            stroke="#334155"
            strokeWidth={compact ? 0.28 : 0.8}
          />
        </pattern>
        {plan && (
          <pattern
            id="terrain-map-grid"
            width={symbol * 2}
            height={symbol * 2}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${symbol * 2} 0 H 0 V ${symbol * 2}`}
              fill="none"
              stroke="#bdc8c4"
              strokeWidth="0.06"
            />
          </pattern>
        )}
      </defs>
      {!plan && (
        <path
          d={groundPath}
          transform={compact ? "translate(0 0.8)" : "translate(0 3)"}
          fill="#91a6b5"
        />
      )}
      <path
        d={groundPath}
        fill="#f5f1e7"
        stroke="#536b7e"
        strokeWidth={plan ? 0.18 : 0.65}
        fillRule="evenodd"
        className="shade-scene-ground"
        onClick={(event) => {
          const point = groundPointAt(
            event.currentTarget,
            origin,
            event.clientX,
            event.clientY,
            plan,
          );
          if (point) onPlace(point);
        }}
      />
      {plan && (
        <path
          d={groundPath}
          fill="url(#terrain-map-grid)"
          fillRule="evenodd"
          pointerEvents="none"
        />
      )}

      {reserved && (
        <path d={path([reserved])} fill="#f9d899" stroke="#a45313"
          strokeWidth="0.12" strokeDasharray="0.3 0.18"
          data-terrain-reserved="" pointerEvents="none" />
      )}
      <g clipPath="url(#shade-scene-surface)" pointerEvents="none">
        {solar &&
          elements
            .filter((element) => element.shadow)
            .map((element) => (
              <path
                key={element.id}
                className="shade-footprint"
                d={element.shadow}
                fill="url(#shade-scene-hatch)"
                fillRule="evenodd"
              />
            ))}
      </g>
      {elements.map((element) => (
        <g key={element.id} pointerEvents="none">
          {element.supports.map(({ base, top }) => (
            <line
              key={base.join(",")}
              x1={base[0]}
              y1={base[1]}
              x2={top[0]}
              y2={top[1]}
              stroke="#334155"
              strokeWidth={element.isTree ? 1.2 : 0.75}
            />
          ))}
          <path
            d={element.roof}
            fill={
              element.furniture
                ? "#d5a067"
                : element.isTree
                  ? "#67ae88"
                  : "#7bc4e8"
            }
            stroke={
              element.furniture
                ? "#744623"
                : element.isTree
                  ? "#205842"
                  : "#075985"
            }
            strokeWidth={plan ? 0.16 : 0.85}
            fillRule="evenodd"
          />
          {showObjectNumbers && (
            <text
              x={element.label[0]}
              y={element.label[1] + (plan ? -symbol * 0.55 : -0.55)}
              textAnchor="middle"
              fontSize={plan ? symbol * 1.65 : 1.15}
              fontWeight="700"
              fill="#102438"
              stroke="#fff"
              strokeWidth="0.22"
              paintOrder="stroke"
              aria-hidden="true"
            >
              {element.number}
            </text>
          )}
        </g>
      ))}
      {placementOutline && placementOutline.length > 1 && (
        <path
          d={path([placementOutline])}
          fill="#075985"
          fillOpacity="0.14"
          stroke="#075985"
          strokeWidth="0.18"
          strokeDasharray="0.4 0.25"
          pointerEvents="none"
        />
      )}
      {plan && (
        <g
          aria-hidden="true"
          pointerEvents="none"
          transform={`translate(${right - symbol * 1.65} ${top + symbol * 1.8}) scale(${symbol})`}
        >
          <text
            x="0"
            y="-0.45"
            textAnchor="middle"
            fontSize="1.1"
            fontWeight="700"
            fill="#38515f"
          >
            N
          </text>
          <path
            d="M 0 1.75 V 0 L -0.45 0.55 M 0 0 L 0.45 0.55"
            fill="none"
            stroke="#38515f"
            strokeWidth="0.16"
          />
        </g>
      )}
      <circle
        cx={project(marker)[0]}
        cy={project(marker)[1]}
        r={plan ? symbol * 0.76 : compact ? 0.55 : 2.2}
        fill="#fff"
        stroke="#075985"
        strokeWidth={compact ? 0.22 : 0.9}
        pointerEvents="none"
      />
    </svg>
  );
}
