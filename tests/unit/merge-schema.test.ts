import { describe, expect, it } from "vitest";
import { mapMergeError } from "@/lib/http/database-errors";
import {
  mergeCommitRequestSchema,
  mergePreviewRequestSchema,
  mergeResolutionSchema,
} from "@/lib/schemas/merge";

const PUB = "11111111-1111-4111-8111-111111111111";
const HEAD = "22222222-2222-4222-8222-222222222222";
const FEATURE_ID = "33333333-3333-4333-8333-333333333333";

const ring = [
  [-98.1984, 19.04368],
  [-98.19828, 19.04368],
  [-98.19828, 19.04378],
  [-98.1984, 19.04378],
  [-98.1984, 19.04368],
];

const market = {
  id: FEATURE_ID,
  kind: "temporary_market",
  properties: {
    label: "Mercado",
    stallCount: 10,
    moduleM2: 6,
    timeSlot: "Sábados 8–14 h",
  },
  geometry: { type: "Polygon", coordinates: [ring] },
};

describe("mergeResolutionSchema", () => {
  it("acepta keep_target, keep_source y remove con o sin featureId", () => {
    for (const resolution of [
      { conflictId: "c1", action: "keep_target" },
      { conflictId: "c1", action: "keep_source" },
      { conflictId: "c1", action: "remove" },
      { conflictId: "c1", action: "remove", featureId: FEATURE_ID },
    ]) {
      expect(mergeResolutionSchema.safeParse(resolution).success).toBe(true);
    }
  });

  it("acepta redraw con una intervención válida", () => {
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "c1",
        action: "redraw",
        feature: market,
      }).success,
    ).toBe(true);
  });

  it("rechaza redraw sin feature o con una intervención inválida", () => {
    expect(
      mergeResolutionSchema.safeParse({ conflictId: "c1", action: "redraw" })
        .success,
    ).toBe(false);
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "c1",
        action: "redraw",
        feature: { ...market, properties: { label: "x" } },
      }).success,
    ).toBe(false);
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "c1",
        action: "redraw",
        feature: {
          ...market,
          geometry: { type: "Polygon", coordinates: [[]] },
        },
      }).success,
    ).toBe(false);
  });

  it("es estricto: rechaza claves extra y acciones desconocidas", () => {
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "c1",
        action: "keep_target",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "c1",
        action: "keep_source",
        featureId: FEATURE_ID,
      }).success,
    ).toBe(false);
    expect(
      mergeResolutionSchema.safeParse({ conflictId: "c1", action: "merge" })
        .success,
    ).toBe(false);
  });

  it("valida conflictId (1..120) y featureId uuid", () => {
    expect(
      mergeResolutionSchema.safeParse({ conflictId: "", action: "remove" })
        .success,
    ).toBe(false);
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "x".repeat(121),
        action: "remove",
      }).success,
    ).toBe(false);
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "x".repeat(120),
        action: "remove",
      }).success,
    ).toBe(true);
    expect(
      mergeResolutionSchema.safeParse({
        conflictId: "c1",
        action: "remove",
        featureId: "no-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("mergePreviewRequestSchema", () => {
  it("resolutions es opcional y por defecto []", () => {
    const parsed = mergePreviewRequestSchema.parse({
      sourcePublicationId: PUB,
    });
    expect(parsed.resolutions).toEqual([]);
  });

  it("rechaza ids no uuid y claves extra", () => {
    expect(
      mergePreviewRequestSchema.safeParse({ sourcePublicationId: "x" }).success,
    ).toBe(false);
    expect(
      mergePreviewRequestSchema.safeParse({
        sourcePublicationId: PUB,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("acepta como máximo 400 resoluciones", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        conflictId: `c${i}`,
        action: "keep_target",
      }));
    expect(
      mergePreviewRequestSchema.safeParse({
        sourcePublicationId: PUB,
        resolutions: make(400),
      }).success,
    ).toBe(true);
    expect(
      mergePreviewRequestSchema.safeParse({
        sourcePublicationId: PUB,
        resolutions: make(401),
      }).success,
    ).toBe(false);
  });
});

describe("mergeCommitRequestSchema", () => {
  const base = {
    sourcePublicationId: PUB,
    expectedHeadId: HEAD,
    message: "Fusiona la propuesta",
    resolutions: [],
  };

  it("acepta una solicitud válida", () => {
    expect(mergeCommitRequestSchema.safeParse(base).success).toBe(true);
  });

  it("recorta el mensaje y exige 1..100 caracteres", () => {
    expect(
      mergeCommitRequestSchema.parse({ ...base, message: "  hola  " }).message,
    ).toBe("hola");
    expect(
      mergeCommitRequestSchema.safeParse({ ...base, message: "   " }).success,
    ).toBe(false);
    expect(
      mergeCommitRequestSchema.safeParse({ ...base, message: "" }).success,
    ).toBe(false);
    expect(
      mergeCommitRequestSchema.safeParse({ ...base, message: "a".repeat(100) })
        .success,
    ).toBe(true);
    expect(
      mergeCommitRequestSchema.safeParse({ ...base, message: "a".repeat(101) })
        .success,
    ).toBe(false);
    expect(
      mergeCommitRequestSchema.safeParse({
        ...base,
        message: ` ${"a".repeat(100)} `,
      }).success,
    ).toBe(true);
  });

  it("exige expectedHeadId y resolutions, y rechaza claves extra", () => {
    const { expectedHeadId: _head, ...noHead } = base;
    void _head;
    expect(mergeCommitRequestSchema.safeParse(noHead).success).toBe(false);
    const { resolutions: _res, ...noRes } = base;
    void _res;
    expect(mergeCommitRequestSchema.safeParse(noRes).success).toBe(false);
    expect(
      mergeCommitRequestSchema.safeParse({ ...base, extra: true }).success,
    ).toBe(false);
  });

  it("rechaza más de 400 resoluciones", () => {
    const resolutions = Array.from({ length: 401 }, (_, i) => ({
      conflictId: `c${i}`,
      action: "remove",
    }));
    expect(
      mergeCommitRequestSchema.safeParse({ ...base, resolutions }).success,
    ).toBe(false);
  });
});

describe("mapMergeError", () => {
  it("28000 → 401", () => {
    expect(mapMergeError({ code: "28000" })).toMatchObject({
      status: 401,
      code: "authentication_required",
    });
  });

  it("P0002 distingue publication_not_found de branch_not_found", () => {
    expect(
      mapMergeError({ code: "P0002", message: "publication_not_found" }),
    ).toMatchObject({ status: 404, code: "publication_not_found" });
    expect(
      mapMergeError({ code: "P0002", message: "branch_not_found" }),
    ).toMatchObject({ status: 404, code: "branch_not_found" });
    expect(mapMergeError({ code: "P0002" })).toMatchObject({
      status: 404,
      code: "branch_not_found",
    });
  });

  it("FT001 → 409 idempotency_conflict", () => {
    expect(mapMergeError({ code: "FT001" })).toMatchObject({
      status: 409,
      code: "idempotency_conflict",
    });
  });

  it("FT409 → 409 stale_head con currentHeadId (o sin details)", () => {
    expect(mapMergeError({ code: "FT409", details: HEAD })).toMatchObject({
      status: 409,
      code: "stale_head",
      details: { currentHeadId: HEAD },
    });
    expect(mapMergeError({ code: "FT409" })?.details).toBeUndefined();
  });

  it.each([
    "merge_incompatible",
    "nothing_to_merge",
    "already_merged",
    "ancestor_limit_exceeded",
    "invalid_resolution",
    "unresolved_conflicts",
    "too_many_features",
  ])("FT422 %s → 422 con el mismo código", (message) => {
    expect(mapMergeError({ code: "FT422", message })).toMatchObject({
      status: 422,
      code: message,
    });
  });

  it("FT422 desconocido → 422 invalid_merge", () => {
    expect(
      mapMergeError({ code: "FT422", message: "otra_cosa" }),
    ).toMatchObject({ status: 422, code: "invalid_merge" });
    expect(mapMergeError({ code: "FT422" })).toMatchObject({
      status: 422,
      code: "invalid_merge",
    });
  });

  it("unresolved_conflicts expone conflictIds si details es un arreglo JSON", () => {
    const mapped = mapMergeError({
      code: "FT422",
      message: "unresolved_conflicts",
      details: JSON.stringify(["a", "b"]),
    });
    expect(mapped?.details).toEqual({ conflictIds: ["a", "b"] });
  });

  it("invalid_resolution expone invalidResolutions si details es un arreglo JSON", () => {
    const items = [{ conflictId: "a", reason: "unknown_conflict" }];
    const mapped = mapMergeError({
      code: "FT422",
      message: "invalid_resolution",
      details: JSON.stringify(items),
    });
    expect(mapped?.details).toEqual({ invalidResolutions: items });
  });

  it("ignora details que no sea un arreglo JSON válido", () => {
    for (const details of ["not json", "{}", '"text"', "42", "", null]) {
      expect(
        mapMergeError({
          code: "FT422",
          message: "unresolved_conflicts",
          details,
        })?.details,
      ).toBeUndefined();
      expect(
        mapMergeError({ code: "FT422", message: "invalid_resolution", details })
          ?.details,
      ).toBeUndefined();
    }
  });

  it("no añade details a otros códigos de dominio aunque haya un arreglo", () => {
    expect(
      mapMergeError({
        code: "FT422",
        message: "already_merged",
        details: "[1]",
      })?.details,
    ).toBeUndefined();
  });

  it("23514 feature_outside_site → 422; otros 23514 → null", () => {
    expect(
      mapMergeError({ code: "23514", message: "feature_outside_site" }),
    ).toMatchObject({ status: 422, code: "feature_outside_site" });
    expect(mapMergeError({ code: "23514", message: "otra" })).toBeNull();
  });

  it("22023 → 400 invalid_merge_request", () => {
    expect(mapMergeError({ code: "22023" })).toMatchObject({
      status: 400,
      code: "invalid_merge_request",
    });
  });

  it("códigos desconocidos → null", () => {
    expect(mapMergeError({ code: "XX000" })).toBeNull();
    expect(mapMergeError({})).toBeNull();
  });
});
