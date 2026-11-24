import {
  projectGeometry,
  unprojectPosition,
  type BoundingBox,
  type DrawableGeometry,
} from "@/lib/geo/project";
import type { Intervention } from "@/lib/schemas/intervention";

type RevisionPreviewProps = {
  ariaLabel: string;
  boundary: DrawableGeometry;
  bounds: BoundingBox;
  features: readonly Intervention[];
  selectedId?: string;
  /** Pointer shortcut: receives the clicked [longitude, latitude]. The form stays the way in for keyboards. */
  onPick?: (longitude: number, latitude: number) => void;
  /** The shape being edited in the form, drawn dashed before it is added. */
  draft?: DrawableGeometry | null;
};

/** Schematic SVG of a snapshot. No hooks, so it renders on the server or the client. */
export function RevisionPreview({
  ariaLabel,
  boundary,
  bounds,
  features,
  selectedId,
  onPick,
  draft,
}: RevisionPreviewProps) {
  const boundaryShape = projectGeometry(boundary, bounds);
  const draftShape = draft ? projectGeometry(draft, bounds) : null;
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
              const box = event.currentTarget.getBoundingClientRect();
              if (box.width === 0 || box.height === 0) return;
              const [longitude, latitude] = unprojectPosition(
                [
                  ((event.clientX - box.left) / box.width) * 1000,
                  ((event.clientY - box.top) / box.height) * 700,
                ],
                bounds,
              );
              onPick(longitude, latitude);
            }
          : undefined
      }
    >
      {boundaryShape.shape === "polygon" ? (
        <polygon className="map-boundary" points={boundaryShape.points} />
      ) : null}
      {features.map((feature) => {
        const shape = projectGeometry(feature.geometry, bounds);
        const className = `preview-${feature.kind}${feature.id === selectedId ? " preview-selected" : ""}`;
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
    </svg>
  );
}
