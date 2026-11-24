import { roundCoordinate } from "@/lib/geo/canonical";
import type { EditableKind, Intervention } from "@/lib/schemas/intervention";

type Position = [number, number];

/** About 11 m north-south and 10.5 m east-west at the pilot latitude. */
const HALF_SIZE = 0.00005;

function at([longitude, latitude]: Position, dx: number, dy: number): Position {
  return [roundCoordinate(longitude + dx), roundCoordinate(latitude + dy)];
}

/** A small, valid starting geometry at the given center, ready to be edited in the form. */
export function createDefaultIntervention(
  kind: EditableKind,
  id: string,
  center: Position,
  labels: { label: string; timeSlot: string },
): Intervention {
  const square = [
    at(center, -HALF_SIZE, -HALF_SIZE),
    at(center, HALF_SIZE, -HALF_SIZE),
    at(center, HALF_SIZE, HALF_SIZE),
    at(center, -HALF_SIZE, HALF_SIZE),
    at(center, -HALF_SIZE, -HALF_SIZE),
  ];

  switch (kind) {
    case "shade_tree":
      return {
        id,
        kind,
        properties: { label: labels.label, canopyDiameterM: 6, heightM: 8 },
        geometry: { type: "Point", coordinates: at(center, 0, 0) },
      };
    case "shade_canopy":
      return {
        id,
        kind,
        properties: { label: labels.label, heightM: 4.5 },
        geometry: { type: "Polygon", coordinates: [square] },
      };
    case "temporary_market":
      return {
        id,
        kind,
        properties: {
          label: labels.label,
          stallCount: 12,
          moduleM2: 6,
          timeSlot: labels.timeSlot,
        },
        geometry: { type: "Polygon", coordinates: [square] },
      };
    case "proposed_crossing":
      return {
        id,
        kind,
        properties: { label: labels.label, widthM: 4 },
        geometry: {
          type: "LineString",
          coordinates: [
            at(center, -HALF_SIZE * 2, 0),
            at(center, HALF_SIZE * 2, 0),
          ],
        },
      };
  }
}

export const geometryTypeForKind: Record<
  EditableKind,
  Intervention["geometry"]["type"]
> = {
  shade_tree: "Point",
  shade_canopy: "Polygon",
  temporary_market: "Polygon",
  proposed_crossing: "LineString",
};
