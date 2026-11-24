import type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
} from "@/lib/schemas/geojson";

export type BoundingBox = readonly [
  west: number,
  south: number,
  east: number,
  north: number,
];

type ProjectedFeature = GeoJsonFeature & {
  svgPoints: string;
};

export function projectPosition(
  [longitude, latitude]: readonly [number, number],
  [west, south, east, north]: BoundingBox,
  width = 1000,
  height = 700,
): readonly [number, number] {
  const longitudeRange = east - west;
  const latitudeRange = north - south;

  if (longitudeRange <= 0 || latitudeRange <= 0) {
    throw new Error("Bounding box must have positive width and height");
  }

  const x = ((longitude - west) / longitudeRange) * width;
  const y = height - ((latitude - south) / latitudeRange) * height;
  return [x, y];
}

/** Inverse of projectPosition: SVG coordinates back to [longitude, latitude]. */
export function unprojectPosition(
  [x, y]: readonly [number, number],
  [west, south, east, north]: BoundingBox,
  width = 1000,
  height = 700,
): readonly [number, number] {
  return [
    west + (x / width) * (east - west),
    south + ((height - y) / height) * (north - south),
  ];
}
type Position = readonly [number, number];

export type DrawableGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: readonly Position[] }
  | { type: "Polygon"; coordinates: readonly (readonly Position[])[] };

export type ProjectedShape =
  | { shape: "point"; cx: number; cy: number }
  | { shape: "line" | "polygon"; points: string };

function toPoints(positions: readonly Position[], bounds: BoundingBox) {
  return positions
    .map((position) => projectPosition(position, bounds))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

/** Projects any supported geometry into SVG coordinates for the schematic preview. */
export function projectGeometry(
  geometry: DrawableGeometry,
  bounds: BoundingBox,
): ProjectedShape {
  switch (geometry.type) {
    case "Point": {
      const [cx, cy] = projectPosition(geometry.coordinates, bounds);
      return { shape: "point", cx, cy };
    }
    case "LineString":
      return { shape: "line", points: toPoints(geometry.coordinates, bounds) };
    case "Polygon":
      return {
        shape: "polygon",
        points: toPoints(geometry.coordinates[0], bounds),
      };
  }
}

export function projectPolygonFeatures(
  collection: GeoJsonFeatureCollection,
  bounds: BoundingBox,
): ProjectedFeature[] {
  return collection.features.flatMap((feature) => {
    if (feature.geometry.type !== "Polygon") return [];

    const svgPoints = feature.geometry.coordinates[0]
      .map((position) => projectPosition(position, bounds))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");

    return [{ ...feature, svgPoints }];
  });
}
