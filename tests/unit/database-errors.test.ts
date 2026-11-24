import { describe, expect, it } from "vitest";
import {
  mapPublishRevisionError,
  mapSaveRevisionError,
} from "@/lib/http/database-errors";

describe("mapSaveRevisionError", () => {
  it("FT409 → 409 stale_head con currentHeadId", () => {
    const head = "55555555-5555-4555-8555-555555555555";
    expect(
      mapSaveRevisionError({ code: "FT409", details: head }),
    ).toMatchObject({
      status: 409,
      code: "stale_head",
      details: { currentHeadId: head },
    });
  });

  it("FT409 sin details no incluye details", () => {
    expect(mapSaveRevisionError({ code: "FT409" })?.details).toBeUndefined();
  });

  it("FT001 → 409 idempotency_conflict", () => {
    expect(mapSaveRevisionError({ code: "FT001" })).toMatchObject({
      status: 409,
      code: "idempotency_conflict",
    });
  });

  it("FT422 con message desconocido → invalid_feature", () => {
    expect(
      mapSaveRevisionError({ code: "FT422", message: "algo_raro" }),
    ).toMatchObject({ status: 422, code: "invalid_feature" });
    expect(mapSaveRevisionError({ code: "FT422" })).toMatchObject({
      status: 422,
      code: "invalid_feature",
    });
  });

  it("FT422 conserva los códigos de feature conocidos", () => {
    expect(
      mapSaveRevisionError({ code: "FT422", message: "too_many_vertices" }),
    ).toMatchObject({ status: 422, code: "too_many_vertices" });
  });

  it("FT422 invalid_geometry con details '2' → featureIndex 2", () => {
    expect(
      mapSaveRevisionError({
        code: "FT422",
        message: "invalid_geometry",
        details: "2",
      }),
    ).toMatchObject({
      status: 422,
      code: "invalid_geometry",
      details: { featureIndex: 2 },
    });
  });

  it("FT422 con details no numérico o negativo no da featureIndex", () => {
    expect(
      mapSaveRevisionError({ code: "FT422", details: "x" })?.details,
    ).toBeUndefined();
    expect(
      mapSaveRevisionError({ code: "FT422", details: "-1" })?.details,
    ).toBeUndefined();
  });

  it("23514 feature_outside_site → 422", () => {
    expect(
      mapSaveRevisionError({ code: "23514", message: "feature_outside_site" }),
    ).toMatchObject({ status: 422, code: "feature_outside_site" });
  });

  it("23514 con otro message → null", () => {
    expect(
      mapSaveRevisionError({ code: "23514", message: "otra_restriccion" }),
    ).toBeNull();
  });

  it("P0002 → 404", () => {
    expect(mapSaveRevisionError({ code: "P0002" })).toMatchObject({
      status: 404,
      code: "branch_not_found",
    });
  });

  it("28000 → 401", () => {
    expect(mapSaveRevisionError({ code: "28000" })).toMatchObject({
      status: 401,
      code: "authentication_required",
    });
  });

  it("código desconocido o ausente → null", () => {
    expect(mapSaveRevisionError({ code: "XX000" })).toBeNull();
    expect(mapSaveRevisionError({})).toBeNull();
  });
});

describe("mapPublishRevisionError", () => {
  it("28000 → 401 authentication_required", () => {
    expect(mapPublishRevisionError({ code: "28000" })).toMatchObject({
      status: 401,
      code: "authentication_required",
    });
  });

  it("P0002 → 404 revision_not_found", () => {
    expect(mapPublishRevisionError({ code: "P0002" })).toMatchObject({
      status: 404,
      code: "revision_not_found",
    });
  });

  it("FT001 → 409 idempotency_conflict", () => {
    expect(mapPublishRevisionError({ code: "FT001" })).toMatchObject({
      status: 409,
      code: "idempotency_conflict",
    });
  });

  it("FT409 → 409 already_published con publicationId de details", () => {
    const id = "66666666-6666-4666-8666-666666666666";
    expect(
      mapPublishRevisionError({ code: "FT409", details: id }),
    ).toMatchObject({
      status: 409,
      code: "already_published",
      details: { publicationId: id },
    });
  });

  it("FT409 sin details no incluye details", () => {
    const mapped = mapPublishRevisionError({ code: "FT409" });
    expect(mapped).toMatchObject({ status: 409, code: "already_published" });
    expect(mapped?.details).toBeUndefined();
    expect(
      mapPublishRevisionError({ code: "FT409", details: "" })?.details,
    ).toBeUndefined();
  });

  it("FT422 con message empty_revision → 422 empty_revision", () => {
    expect(
      mapPublishRevisionError({ code: "FT422", message: "empty_revision" }),
    ).toMatchObject({ status: 422, code: "empty_revision" });
  });

  it("cualquier otro FT422 → 422 invalid_publication", () => {
    expect(
      mapPublishRevisionError({ code: "FT422", message: "otra_cosa" }),
    ).toMatchObject({ status: 422, code: "invalid_publication" });
    expect(mapPublishRevisionError({ code: "FT422" })).toMatchObject({
      status: 422,
      code: "invalid_publication",
    });
  });

  it("22023 → 422 invalid_publication", () => {
    expect(mapPublishRevisionError({ code: "22023" })).toMatchObject({
      status: 422,
      code: "invalid_publication",
    });
  });

  it("22023 missing_profile → 409 profile_required", () => {
    expect(
      mapPublishRevisionError({ code: "22023", message: "missing_profile" }),
    ).toMatchObject({ status: 409, code: "profile_required" });
  });

  it("22023 con otro message → 422 invalid_publication", () => {
    expect(
      mapPublishRevisionError({ code: "22023", message: "otra_cosa" }),
    ).toMatchObject({ status: 422, code: "invalid_publication" });
    expect(
      mapPublishRevisionError({ code: "22023", message: null }),
    ).toMatchObject({ status: 422, code: "invalid_publication" });
  });

  it("código desconocido o ausente → null", () => {
    expect(mapPublishRevisionError({ code: "XX000" })).toBeNull();
    expect(mapPublishRevisionError({ code: "23514" })).toBeNull();
    expect(mapPublishRevisionError({})).toBeNull();
  });
});
