import { describe, expect, it } from "vitest";
import {
  ownerPublicationsSchema,
  publicPublicationSchema,
  publishRevisionRequestSchema,
} from "@/lib/schemas/publication";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const FEATURE_ID = "44444444-4444-4444-8444-444444444444";

describe("publishRevisionRequestSchema", () => {
  it("acepta valores válidos y recorta espacios", () => {
    expect(
      publishRevisionRequestSchema.parse({
        label: "  Sombra  ",
        summary: "  Resumen  ",
      }),
    ).toEqual({ label: "Sombra", summary: "Resumen" });
  });

  it("rechaza etiqueta vacía o solo espacios", () => {
    expect(
      publishRevisionRequestSchema.safeParse({ label: "", summary: "x" })
        .success,
    ).toBe(false);
    expect(
      publishRevisionRequestSchema.safeParse({ label: "   ", summary: "x" })
        .success,
    ).toBe(false);
  });

  it("rechaza resumen vacío o solo espacios", () => {
    expect(
      publishRevisionRequestSchema.safeParse({ label: "x", summary: " \n " })
        .success,
    ).toBe(false);
  });

  it("límites: etiqueta 100 sí, 101 no", () => {
    const ok = (label: string) =>
      publishRevisionRequestSchema.safeParse({ label, summary: "x" }).success;
    expect(ok("a".repeat(100))).toBe(true);
    expect(ok("a".repeat(101))).toBe(false);
  });

  it("límites: resumen 1000 sí, 1001 no", () => {
    const ok = (summary: string) =>
      publishRevisionRequestSchema.safeParse({ label: "x", summary }).success;
    expect(ok("a".repeat(1000))).toBe(true);
    expect(ok("a".repeat(1001))).toBe(false);
  });

  it("rechaza tipos incorrectos y campos ausentes", () => {
    expect(publishRevisionRequestSchema.safeParse({}).success).toBe(false);
    expect(
      publishRevisionRequestSchema.safeParse({ label: 1, summary: "x" })
        .success,
    ).toBe(false);
  });
});

const publication = {
  publicationId: ID,
  label: "Sombra",
  summary: "Resumen",
  authorAlias: "vecina",
  publishedAt: "2025-01-01T00:00:00Z",
  siteId: ID2,
  baselineId: ID3,
  scenario: "hypothetical" as const,
  features: [
    {
      id: FEATURE_ID,
      kind: "shade_canopy" as const,
      properties: { label: "Cubierta", heightM: 3 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-98.19, 19.04],
            [-98.189, 19.04],
            [-98.189, 19.041],
            [-98.19, 19.04],
          ],
        ],
      },
    },
  ],
};

describe("publicPublicationSchema", () => {
  it("acepta la proyección pública completa", () => {
    expect(publicPublicationSchema.safeParse(publication).success).toBe(true);
  });

  it.each(["branchId", "email", "message", "revisionId", "userId"])(
    "rechaza la clave extra %s",
    (key) => {
      expect(
        publicPublicationSchema.safeParse({ ...publication, [key]: "x" })
          .success,
      ).toBe(false);
    },
  );

  it("exige scenario hypothetical", () => {
    expect(
      publicPublicationSchema.safeParse({ ...publication, scenario: "real" })
        .success,
    ).toBe(false);
  });

  it("rechaza ids que no son UUID", () => {
    expect(
      publicPublicationSchema.safeParse({
        ...publication,
        publicationId: "no-uuid",
      }).success,
    ).toBe(false);
  });

  it("rechaza intervenciones duplicadas", () => {
    expect(
      publicPublicationSchema.safeParse({
        ...publication,
        features: [publication.features[0], publication.features[0]],
      }).success,
    ).toBe(false);
  });
});

describe("ownerPublicationsSchema", () => {
  it("mapea filas snake_case a la forma del editor", () => {
    expect(
      ownerPublicationsSchema.parse([
        {
          id: ID,
          revision_id: ID2,
          public_label: "Sombra",
          published_at: "2025-01-01T00:00:00Z",
          moderation_state: "visible",
          extra: "ignorado",
        },
      ]),
    ).toEqual([
      {
        id: ID,
        revisionId: ID2,
        label: "Sombra",
        publishedAt: "2025-01-01T00:00:00Z",
        hidden: false,
      },
    ]);
  });

  it("moderation_state hidden → hidden true", () => {
    expect(
      ownerPublicationsSchema.parse([
        {
          id: ID,
          revision_id: ID2,
          public_label: "Sombra",
          published_at: "2025-01-01T00:00:00Z",
          moderation_state: "hidden",
        },
      ]),
    ).toEqual([
      {
        id: ID,
        revisionId: ID2,
        label: "Sombra",
        publishedAt: "2025-01-01T00:00:00Z",
        hidden: true,
      },
    ]);
  });

  it("rechaza moderation_state inválido o ausente", () => {
    const row = {
      id: ID,
      revision_id: ID2,
      public_label: "Sombra",
      published_at: "2025-01-01T00:00:00Z",
    };
    expect(
      ownerPublicationsSchema.safeParse([{ ...row, moderation_state: "removed" }])
        .success,
    ).toBe(false);
    expect(ownerPublicationsSchema.safeParse([row]).success).toBe(false);
  });

  it("acepta lista vacía y rechaza filas incompletas", () => {
    expect(ownerPublicationsSchema.parse([])).toEqual([]);
    expect(ownerPublicationsSchema.safeParse([{ id: ID }]).success).toBe(false);
  });
});
