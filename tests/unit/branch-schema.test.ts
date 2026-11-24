import { describe, expect, it } from "vitest";
import {
  branchPayloadFingerprint,
  createBranchRequestSchema,
  createBranchResponseSchema,
} from "@/lib/schemas/branch";

const SITE = "11111111-1111-4111-8111-111111111111";
const PUBLICATION = "22222222-2222-4222-8222-222222222222";
const BRANCH = "33333333-3333-4333-8333-333333333333";
const REVISION = "44444444-4444-4444-8444-444444444444";
const BASELINE = "55555555-5555-4555-8555-555555555555";

describe("createBranchRequestSchema", () => {
  it("acepta la variante de sitio y recorta el título", () => {
    expect(
      createBranchRequestSchema.parse({ siteId: SITE, title: "  Mi rama  " }),
    ).toEqual({ siteId: SITE, title: "Mi rama" });
  });

  it("acepta la variante de publicación y recorta el título", () => {
    expect(
      createBranchRequestSchema.parse({
        sourcePublicationId: PUBLICATION,
        title: "  Alternativa  ",
      }),
    ).toEqual({ sourcePublicationId: PUBLICATION, title: "Alternativa" });
  });

  it("acepta títulos de 1 y de 100 caracteres", () => {
    for (const title of ["x", "x".repeat(100)]) {
      expect(
        createBranchRequestSchema.safeParse({
          sourcePublicationId: PUBLICATION,
          title,
        }).success,
      ).toBe(true);
    }
  });

  it("rechaza un cuerpo con siteId y sourcePublicationId a la vez", () => {
    expect(
      createBranchRequestSchema.safeParse({
        siteId: SITE,
        sourcePublicationId: PUBLICATION,
        title: "Ambos",
      }).success,
    ).toBe(false);
  });

  it("rechaza claves adicionales en ambas variantes", () => {
    expect(
      createBranchRequestSchema.safeParse({
        siteId: SITE,
        title: "Extra",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      createBranchRequestSchema.safeParse({
        sourcePublicationId: PUBLICATION,
        title: "Extra",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("rechaza títulos vacíos, en blanco o de más de 100 caracteres", () => {
    for (const title of ["", "   ", "x".repeat(101)]) {
      expect(
        createBranchRequestSchema.safeParse({
          sourcePublicationId: PUBLICATION,
          title,
        }).success,
      ).toBe(false);
      expect(
        createBranchRequestSchema.safeParse({ siteId: SITE, title }).success,
      ).toBe(false);
    }
  });

  it("rechaza uuid inválidos y fuentes ausentes", () => {
    expect(
      createBranchRequestSchema.safeParse({
        sourcePublicationId: "no-es-uuid",
        title: "Ok",
      }).success,
    ).toBe(false);
    expect(
      createBranchRequestSchema.safeParse({ siteId: "no-es-uuid", title: "Ok" })
        .success,
    ).toBe(false);
    expect(
      createBranchRequestSchema.safeParse({ title: "Sin fuente" }).success,
    ).toBe(false);
  });

  it("rechaza título ausente o no textual", () => {
    expect(
      createBranchRequestSchema.safeParse({ sourcePublicationId: PUBLICATION })
        .success,
    ).toBe(false);
    expect(
      createBranchRequestSchema.safeParse({ siteId: SITE, title: 5 }).success,
    ).toBe(false);
  });
});

describe("branchPayloadFingerprint", () => {
  it("conserva la forma original para sitio", () => {
    expect(branchPayloadFingerprint({ siteId: SITE, title: "A" })).toEqual({
      siteId: SITE,
      title: "A",
    });
  });

  it("usa sourcePublicationId para bifurcaciones y no incluye siteId", () => {
    const fingerprint = branchPayloadFingerprint({
      sourcePublicationId: PUBLICATION,
      title: "A",
    });
    expect(fingerprint).toEqual({
      sourcePublicationId: PUBLICATION,
      title: "A",
    });
    expect(Object.keys(fingerprint)).not.toContain("siteId");
  });
});

describe("createBranchResponseSchema", () => {
  const base = {
    branchId: BRANCH,
    revisionId: REVISION,
    siteId: SITE,
    title: "T",
  };

  it("acepta la respuesta sin campos de bifurcación", () => {
    expect(createBranchResponseSchema.safeParse({ data: base }).success).toBe(
      true,
    );
  });

  it("acepta la respuesta con campos de bifurcación", () => {
    const parsed = createBranchResponseSchema.parse({
      data: {
        ...base,
        baselineId: BASELINE,
        baselineIsActive: false,
        sourcePublicationId: PUBLICATION,
        featureCount: 0,
      },
    });
    expect(parsed.data.sourcePublicationId).toBe(PUBLICATION);
    expect(parsed.data.baselineIsActive).toBe(false);
    expect(parsed.data.featureCount).toBe(0);
  });

  it("rechaza featureCount negativo o fraccionario y uuid inválidos", () => {
    for (const extra of [
      { featureCount: -1 },
      { featureCount: 1.5 },
      { sourcePublicationId: "x" },
      { baselineId: "x" },
    ]) {
      expect(
        createBranchResponseSchema.safeParse({ data: { ...base, ...extra } })
          .success,
      ).toBe(false);
    }
  });
});
