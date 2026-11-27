"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/schemas/shade-scene";
import type es from "@/messages/es.json";
import { maxCorners, planHeight, planWidth } from "./terrain-model";

export function TerrainOutline({
  corners,
  photoUrl,
  onChange,
  copy,
  access = [],
  onAccessPoint,
  photoDraft = false,
}: {
  corners: Point[];
  photoUrl: string;
  onChange: (next: Point[]) => void;
  copy: typeof es.terrain;
  access?: Point[];
  onAccessPoint?: (point: Point) => void;
  photoDraft?: boolean;
}) {
  const [cursor, setCursor] = useState<Point>([100, 90]);
  const pointButton = useRef<HTMLButtonElement>(null);
  const markingAccess = Boolean(onAccessPoint);

  const [repeatedCorner, setRepeatedCorner] = useState(false);

  useEffect(() => {
    if (markingAccess) pointButton.current?.focus();
  }, [markingAccess]);

  function add(point: Point) {
    if (onAccessPoint) {
      onAccessPoint(point);
      return;
    }
    const overlaps = corners.some(
      ([x, y]) => Math.hypot(x - point[0], y - point[1]) <= 8,
    );
    setRepeatedCorner(overlaps);
    if (!overlaps && corners.length < maxCorners) onChange([...corners, point]);
  }

  return (
    <>
      <svg
        className="terrain-plan"
        viewBox={`0 0 ${planWidth} ${planHeight}`}
        aria-label={photoDraft ? copy.photoFit.plan : copy.plan}
        role="img"
        onClick={(event) => {
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const { x, y } = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(matrix.inverse());
          if (x < 0 || x > planWidth || y < 0 || y > planHeight) return;
          const point: Point = [Math.round(x), Math.round(y)];
          setCursor(point);
          add(point);
        }}
      >
        <defs>
          <pattern
            id="terrain-grid"
            width="25"
            height="25"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 25 0 H 0 V 25" fill="none" stroke="#c0d0df" />
          </pattern>
        </defs>
        <rect width={planWidth} height={planHeight} fill="#edf4f8" />
        {photoUrl ? (
          <image
            href={photoUrl}
            width={planWidth}
            height={planHeight}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <rect
            width={planWidth}
            height={planHeight}
            fill="url(#terrain-grid)"
          />
        )}
        {!photoDraft && (
          <>
            <path
              d="M 470 55 V 24 L 463 34 M 470 24 L 477 34"
              stroke="#334155"
              strokeWidth="2"
              fill="none"
            />
            <text x="470" y="19" textAnchor="middle" fill="#0f172a">
              N
            </text>
          </>
        )}
        <polygon
          points={corners.map((point) => point.join(",")).join(" ")}
          fill="#d4e9dd"
          fillOpacity={photoUrl ? "0.3" : "0.75"}
          stroke="#166345"
          strokeDasharray="5 3"
          strokeWidth="2"
        />
        {corners.length >= 2 && (
          <line
            x1={corners[0][0]}
            y1={corners[0][1]}
            x2={corners[1][0]}
            y2={corners[1][1]}
            stroke="#075985"
            strokeWidth="4"
          />
        )}
        {corners.map(([x, y], index) => (
          <g key={index}>
            <circle cx={x} cy={y} r="8" fill="#075985" />
            <text
              x={x}
              y={y + 4}
              textAnchor="middle"
              fill="white"
              fontSize="10"
            >
              {index + 1}
            </text>
          </g>
        ))}
        {access.length > 0 && (
          <polyline
            points={(access.length === 1 ? [...access, cursor] : access)
              .map((point) => point.join(","))
              .join(" ")}
            fill="none"
            stroke="#b45309"
            strokeWidth="6"
            strokeDasharray="6 3"
          />
        )}
        {access.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r="5" fill="#b45309" />
        ))}
        <circle
          cx={cursor[0]}
          cy={cursor[1]}
          r="10"
          fill="none"
          stroke="#0f172a"
          strokeWidth="2"
        />
      </svg>
      <div className="terrain-actions">
        <button
          ref={pointButton}
          type="button"
          className="button"
          aria-describedby="terrain-plan-help"
          disabled={!onAccessPoint && corners.length >= maxCorners}
          onClick={() => add(cursor)}
          onKeyDown={(event) => {
            const steps: Record<string, Point> = {
              ArrowLeft: [-10, 0],
              ArrowRight: [10, 0],
              ArrowUp: [0, -10],
              ArrowDown: [0, 10],
            };
            if (!Object.hasOwn(steps, event.key)) return;
            event.preventDefault();
            const [dx, dy] = steps[event.key];
            setCursor(([x, y]) => [
              Math.max(0, Math.min(planWidth, x + dx)),
              Math.max(0, Math.min(planHeight, y + dy)),
            ]);
          }}
        >
          {onAccessPoint ? copy.photoFit.addPassagePoint : copy.addCorner}
        </button>
        <button
          type="button"
          className="button"
          disabled={Boolean(onAccessPoint) || corners.length === 0}
          onClick={() => {
            setRepeatedCorner(false);
            onChange(corners.slice(0, -1));
          }}
        >
          {copy.undoCorner}
        </button>
      </div>
      <p className="field-help" role="status">
        {copy.corners.replace("{count}", String(corners.length))}
        {repeatedCorner && corners.length > 0 && (
          <>
            <br />
            {copy.repeatedCorner}
          </>
        )}
      </p>
    </>
  );
}
