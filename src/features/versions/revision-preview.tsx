import {
  projectGeometry,
  projectPosition,
  unprojectPosition,
  type BoundingBox,
  type DrawableGeometry,
} from "@/lib/geo/project";
import type { Intervention } from "@/lib/schemas/intervention";
import { urbanObjectCenter } from "@/lib/geo/urban-object";

type RevisionPreviewProps = {
  ariaLabel: string;
  boundary: DrawableGeometry;
  bounds: BoundingBox;
  features: readonly Intervention[];
  selectedId?: string;
  conflictingIds?: ReadonlySet<string>;
  /** Pointer shortcut: receives the clicked [longitude, latitude]. The form stays the way in for keyboards. */
  onPick?: (longitude: number, latitude: number) => void;
  /** The shape being edited in the form, drawn dashed before it is added. */
  draft?: DrawableGeometry | null;
  markDraftCenter?: boolean;
};

export function revisionPositionAt(
  svg: SVGSVGElement,
  bounds: BoundingBox,
  x: number,
  y: number,
) {
  const transform = svg.getScreenCTM();
  if (!transform) return null;
  const point = new DOMPoint(x, y).matrixTransform(transform.inverse());
  if (point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 700)
    return null;
  return unprojectPosition([point.x, point.y], bounds);
}

/** Schematic SVG of a snapshot. No hooks, so it renders on the server or the client. */
export function RevisionPreview({
  ariaLabel,
  boundary,
  bounds,
  features,
  selectedId,
  conflictingIds,
  onPick,
  draft,
  markDraftCenter = false,
}: RevisionPreviewProps) {
  const boundaryShape = projectGeometry(boundary, bounds);
  const draftShape = draft ? projectGeometry(draft, bounds) : null;
  const draftCenter =
    markDraftCenter && draft?.type === "Polygon"
      ? projectPosition(urbanObjectCenter(draft.coordinates[0]), bounds)
      : null;
  return (
    <svg
      className={
        onPick ? "editor-preview editor-preview-pick" : "editor-preview"
      }
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 1000 700"
      onClick={
        onPick
          ? (event) => {
              const point = revisionPositionAt(
                event.currentTarget,
                bounds,
                event.clientX,
                event.clientY,
              );
              if (point) onPick(...point);
            }
          : undefined
      }
    >
      {boundaryShape.shape === "polygon" ? (
        <polygon className="map-boundary" points={boundaryShape.points} />
      ) : null}
      {features.map((feature) => {
        const shape = projectGeometry(feature.geometry, bounds);
        const className = `preview-${feature.kind}${feature.id === selectedId ? " preview-selected" : ""}${conflictingIds?.has(feature.id) ? " preview-conflict" : ""}`;
        if (shape.shape === "point") {
          return (
            <circle
              key={feature.id}
              className={className}
              cx={shape.cx}
              cy={shape.cy}
              r="16"
            />
          );
        }
        if (shape.shape === "line") {
          return (
            <polyline
              key={feature.id}
              className={className}
              points={shape.points}
            />
          );
        }
        return (
          <polygon
            key={feature.id}
            className={className}
            points={shape.points}
          />
        );
      })}
      {draftShape?.shape === "point" ? (
        <circle
          className="preview-draft"
          cx={draftShape.cx}
          cy={draftShape.cy}
          r="18"
        />
      ) : draftShape ? (
        <polygon className="preview-draft" points={draftShape.points} />
      ) : null}
      {draftCenter && (
        <circle
          className="editor-object-location"
          cx={draftCenter[0]}
          cy={draftCenter[1]}
          r="7"
        />
      )}
    </svg>
  );
}
