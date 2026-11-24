import type { PublicDossier } from "@/lib/schemas/dossier";

/**
 * GeoJSON export of a dossier's interventions (RFC 7946): WGS84, [longitude, latitude],
 * no `crs` member, finite numbers only. Every feature is flagged hypothetical: an
 * intervention is a proposal, never a record of something built.
 */

type Position = [number, number];
type GeometryInput =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] };

export type DossierFeature = {
  type: "Feature";
  id: string;
  geometry: GeometryInput;
  properties: {
    kind: string;
    label: string;
    status: "hypothetical";
    attributes: Record<string, unknown>;
    dossierId: string;
    publicationId: string;
  };
};

export type DossierFeatureCollection = {
  type: "FeatureCollection";
  features: DossierFeature[];
  metadata: {
    source: string;
    scenario: string;
    budgetLabel: string;
    generatedAt: string;
  };
};

export function toFeatureCollection(
  dossier: PublicDossier,
  generatedAt: Date,
): DossierFeatureCollection {
  return {
    type: "FeatureCollection",
    features: dossier.publication.features.map((feature) => {
      const { label, ...attributes } = feature.properties as Record<
        string,
        unknown
      > & {
        label: string;
      };
      return {
        type: "Feature",
        id: feature.id,
        geometry: feature.geometry as GeometryInput,
        properties: {
          kind: feature.kind,
          label,
          status: "hypothetical",
          attributes,
          dossierId: dossier.dossierId,
          publicationId: dossier.publicationId,
        },
      };
    }),
    metadata: {
      source: `Fork the City dossier ${dossier.dossierId}; hypothetical proposal, not an observation.`,
      scenario: dossier.snapshot.scenario.slug,
      budgetLabel: dossier.snapshot.cost.label,
      generatedAt: generatedAt.toISOString(),
    },
  };
}

const isFinitePosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((part) => typeof part === "number" && Number.isFinite(part)) &&
  Math.abs(value[0]) <= 180 &&
  Math.abs(value[1]) <= 90;

const sameVertex = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/**
 * Structural RFC 7946 check used by the tests: positions are finite [lon, lat] inside
 * WGS84 bounds, polygon rings are closed with at least four positions, lines have at
 * least two, and no `crs` member exists. Returns a list of problems (empty when valid).
 */
export function validateGeoJson(collection: unknown): string[] {
  const problems: string[] = [];
  const root = collection as Partial<DossierFeatureCollection> &
    Record<string, unknown>;
  if (root?.type !== "FeatureCollection" || !Array.isArray(root.features)) {
    return ["not a FeatureCollection"];
  }
  if ("crs" in root) problems.push("crs member is not allowed");
  root.features.forEach((feature, index) => {
    const where = `feature ${index}`;
    if (feature?.type !== "Feature") problems.push(`${where}: not a Feature`);
    const geometry = feature?.geometry as GeometryInput | undefined;
    if (!geometry) {
      problems.push(`${where}: missing geometry`);
      return;
    }
    if (geometry.type === "Point") {
      if (!isFinitePosition(geometry.coordinates))
        problems.push(`${where}: bad point`);
    } else if (geometry.type === "LineString") {
      const line = geometry.coordinates;
      if (
        !Array.isArray(line) ||
        line.length < 2 ||
        !line.every(isFinitePosition)
      ) {
        problems.push(`${where}: bad line`);
      }
    } else if (geometry.type === "Polygon") {
      const rings = geometry.coordinates;
      if (!Array.isArray(rings) || rings.length < 1) {
        problems.push(`${where}: polygon without rings`);
      } else {
        for (const ring of rings) {
          if (
            !Array.isArray(ring) ||
            ring.length < 4 ||
            !ring.every(isFinitePosition) ||
            !sameVertex(ring[0], ring[ring.length - 1])
          ) {
            problems.push(`${where}: ring is not closed or too short`);
          }
        }
      }
    } else {
      problems.push(`${where}: unsupported geometry`);
    }
  });
  return problems;
}
