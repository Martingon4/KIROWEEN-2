import { describe, expect, it } from "vitest";
import {
  correctionRequestSchema,
  dossierListSchema,
  evidenceRequestSchema,
  evidenceUrlSchema,
  managedDossierSchema,
  milestoneRequestSchema,
  milestoneUpdateRequestSchema,
  promoteDossierRequestSchema,
  publicDossierSchema,
  responsibleRequestSchema,
  transitionRequestSchema,
  verificationRequestSchema,
} from "@/lib/schemas/dossier";
import { FIXTURE_IDS, buildDossier } from "../fixtures/dossier";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe("evidenceUrlSchema", () => {
  it("accepts a plain https URL with query and fragment", () => {
    expect(ok(evidenceUrlSchema, "https://colectivo.example.org/a?b=c#d")).toBe(
      true,
    );
  });

  it("accepts a URL of exactly 2048 characters", () => {
    const url = `https://a.example/${"a".repeat(2048 - "https://a.example/".length)}`;
    expect(url).toHaveLength(2048);
    expect(ok(evidenceUrlSchema, url)).toBe(true);
  });

  it.each([
    ["http", "http://colectivo.example.org/a"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,x"],
    ["ftp", "ftp://files.example.org/a"],
    ["credentials", "https://user:pw@example.com"],
    ["user only", "https://user@example.com"],
    ["no dot in host", "https://localhost"],
    ["space in host", "https://a b.com"],
    ["space in path", "https://a.example/a b"],
    ["angle bracket <", "https://a.example/<x"],
    ["angle bracket >", "https://a.example/x>"],
    ["double quote", 'https://a.example/"x'],
    ["backslash", "https://a.example/a\\b"],
    ["empty", ""],
    ["not a URL", "colectivo.example.org"],
    ["relative", "/a/b"],
    ["newline", "https://a.example/a\nb"],
  ])("rejects %s", (_name, value) => {
    expect(ok(evidenceUrlSchema, value)).toBe(false);
  });

  it("rejects more than 2048 characters", () => {
    expect(ok(evidenceUrlSchema, `https://a.example/${"a".repeat(2040)}`)).toBe(
      false,
    );
  });

  it("rejects non-strings", () => {
    expect(ok(evidenceUrlSchema, null)).toBe(false);
    expect(ok(evidenceUrlSchema, 5)).toBe(false);
  });
});

describe("promoteDossierRequestSchema", () => {
  const base = { decisionNote: "Aprobado por asamblea." };

  it("accepts the minimal request and the full request", () => {
    expect(ok(promoteDossierRequestSchema, base)).toBe(true);
    expect(
      ok(promoteDossierRequestSchema, {
        ...base,
        responsibleName: "Colectivo Sombra",
        responsibleAuthorized: true,
        targetDate: "2027-03-15",
      }),
    ).toBe(true);
    expect(
      ok(promoteDossierRequestSchema, {
        ...base,
        responsibleName: null,
        targetDate: null,
      }),
    ).toBe(true);
  });

  it("is strict: unknown keys are rejected", () => {
    expect(ok(promoteDossierRequestSchema, { ...base, extra: 1 })).toBe(false);
  });

  it("trims the note and enforces 1..1000 characters", () => {
    const parsed = promoteDossierRequestSchema.parse({
      decisionNote: "  hola  ",
    });
    expect(parsed.decisionNote).toBe("hola");
    expect(ok(promoteDossierRequestSchema, { decisionNote: "" })).toBe(false);
    expect(ok(promoteDossierRequestSchema, { decisionNote: "   " })).toBe(false);
    expect(
      ok(promoteDossierRequestSchema, { decisionNote: "a".repeat(1000) }),
    ).toBe(true);
    expect(
      ok(promoteDossierRequestSchema, { decisionNote: "a".repeat(1001) }),
    ).toBe(false);
    expect(ok(promoteDossierRequestSchema, {})).toBe(false);
  });

  it("rejects a responsible name with '@' (no emails) and over 100 characters", () => {
    expect(
      ok(promoteDossierRequestSchema, { ...base, responsibleName: "ana@x.org" }),
    ).toBe(false);
    expect(
      ok(promoteDossierRequestSchema, { ...base, responsibleName: "@ana" }),
    ).toBe(false);
    expect(
      ok(promoteDossierRequestSchema, {
        ...base,
        responsibleName: "a".repeat(101),
      }),
    ).toBe(false);
    expect(
      ok(promoteDossierRequestSchema, { ...base, responsibleName: "" }),
    ).toBe(false);
  });

  it("normalizes CRLF and lone CR to LF", () => {
    const parsed = promoteDossierRequestSchema.parse({
      decisionNote: "uno\r\ndos\rtres",
    });
    expect(parsed.decisionNote).toBe("uno\ndos\ntres");
  });

  it.each([
    ["NUL", "a\u0000b"],
    ["tab", "a\tb"],
    ["escape", "a\u001bb"],
    ["DEL", "a\u007fb"],
    ["C1 control", "a\u0085b"],
    ["soft hyphen", "a\u00adb"],
    ["zero-width space", "a\u200bb"],
    ["bidi override RLO", "a\u202eb"],
    ["bidi isolate", "a\u2066b"],
    ["BOM inside", "a\ufeffb"],
    ["line separator", "a\u2028b"],
  ])("rejects %s in the note", (_name, value) => {
    expect(ok(promoteDossierRequestSchema, { decisionNote: value })).toBe(false);
  });

  it("rejects date strings with the wrong shape", () => {
    for (const targetDate of ["2027-3-1", "15/03/2027", "2027-03-15T00:00", ""]) {
      expect(ok(promoteDossierRequestSchema, { ...base, targetDate })).toBe(
        false,
      );
    }
  });

  it("keeps HTML as plain text, never interpreted or stripped", () => {
    const parsed = promoteDossierRequestSchema.parse({
      decisionNote: "<b>x</b>",
    });
    expect(parsed.decisionNote).toBe("<b>x</b>");
  });
});

describe("responsibleRequestSchema", () => {
  it("accepts a name or null and requires the key", () => {
    expect(ok(responsibleRequestSchema, { responsibleName: "Ana" })).toBe(true);
    expect(ok(responsibleRequestSchema, { responsibleName: null })).toBe(true);
    expect(
      ok(responsibleRequestSchema, {
        responsibleName: "Ana",
        responsibleAuthorized: false,
      }),
    ).toBe(true);
    expect(ok(responsibleRequestSchema, {})).toBe(false);
  });

  it("rejects '@', control characters and unknown keys", () => {
    expect(ok(responsibleRequestSchema, { responsibleName: "a@b" })).toBe(false);
    expect(ok(responsibleRequestSchema, { responsibleName: "a\u0000" })).toBe(
      false,
    );
    expect(
      ok(responsibleRequestSchema, { responsibleName: "Ana", x: 1 }),
    ).toBe(false);
  });
});

describe("milestone request schemas", () => {
  it("accepts a title and a date", () => {
    expect(
      ok(milestoneRequestSchema, { title: "Consulta", targetDate: "2026-09-01" }),
    ).toBe(true);
  });

  it("rejects empty or long titles, bad dates and extra keys", () => {
    expect(
      ok(milestoneRequestSchema, { title: " ", targetDate: "2026-09-01" }),
    ).toBe(false);
    expect(
      ok(milestoneRequestSchema, {
        title: "a".repeat(101),
        targetDate: "2026-09-01",
      }),
    ).toBe(false);
    expect(ok(milestoneRequestSchema, { title: "x", targetDate: "hoy" })).toBe(
      false,
    );
    expect(
      ok(milestoneRequestSchema, {
        title: "x",
        targetDate: "2026-09-01",
        id: UUID,
      }),
    ).toBe(false);
  });

  it("validates the update request including the status enums", () => {
    const update = {
      expectedStatus: "pendiente",
      title: "Consulta",
      targetDate: "2026-09-01",
      status: "cumplido",
    };
    expect(ok(milestoneUpdateRequestSchema, update)).toBe(true);
    expect(
      ok(milestoneUpdateRequestSchema, { ...update, status: "hecho" }),
    ).toBe(false);
    expect(
      ok(milestoneUpdateRequestSchema, { ...update, expectedStatus: "x" }),
    ).toBe(false);
  });
});

describe("evidenceRequestSchema and verificationRequestSchema", () => {
  const evidence = {
    url: "https://colectivo.example.org/a",
    title: "Acta",
    description: "Acta firmada.",
    evidenceDate: "2026-05-01",
  };

  it("accepts a valid evidence request", () => {
    expect(ok(evidenceRequestSchema, evidence)).toBe(true);
  });

  it("rejects http URLs, empty fields and extra keys", () => {
    expect(
      ok(evidenceRequestSchema, { ...evidence, url: "http://a.example/x" }),
    ).toBe(false);
    expect(ok(evidenceRequestSchema, { ...evidence, title: "" })).toBe(false);
    expect(ok(evidenceRequestSchema, { ...evidence, description: "" })).toBe(
      false,
    );
    expect(
      ok(evidenceRequestSchema, { ...evidence, description: "a".repeat(1001) }),
    ).toBe(false);
    expect(ok(evidenceRequestSchema, { ...evidence, evidenceDate: "x" })).toBe(
      false,
    );
    expect(ok(evidenceRequestSchema, { ...evidence, verified: true })).toBe(
      false,
    );
  });

  it("verification needs a boolean", () => {
    expect(ok(verificationRequestSchema, { verified: true })).toBe(true);
    expect(ok(verificationRequestSchema, { verified: "yes" })).toBe(false);
    expect(ok(verificationRequestSchema, {})).toBe(false);
  });
});

describe("transitionRequestSchema", () => {
  const base = { expectedState: "en_revision", newState: "planeado" };

  it("defaults evidenceIds to an empty array", () => {
    const parsed = transitionRequestSchema.parse(base);
    expect(parsed.evidenceIds).toEqual([]);
  });

  it("accepts optional note, observation and difference, including null", () => {
    expect(
      ok(transitionRequestSchema, {
        ...base,
        note: "n",
        observation: null,
        difference: "d",
        evidenceIds: [UUID],
      }),
    ).toBe(true);
  });

  it("allows up to 50 evidence ids and rejects 51", () => {
    const ids = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
      );
    expect(ok(transitionRequestSchema, { ...base, evidenceIds: ids(50) })).toBe(
      true,
    );
    expect(ok(transitionRequestSchema, { ...base, evidenceIds: ids(51) })).toBe(
      false,
    );
  });

  it("rejects non-uuid ids, unknown states and unknown keys", () => {
    expect(
      ok(transitionRequestSchema, { ...base, evidenceIds: ["nope"] }),
    ).toBe(false);
    expect(
      ok(transitionRequestSchema, { ...base, newState: "cerrado" }),
    ).toBe(false);
    expect(
      ok(transitionRequestSchema, { ...base, expectedState: undefined }),
    ).toBe(false);
    expect(ok(transitionRequestSchema, { ...base, actor: "x" })).toBe(false);
  });

  it("applies plain-text rules to note, observation and difference", () => {
    for (const field of ["note", "observation", "difference"]) {
      expect(ok(transitionRequestSchema, { ...base, [field]: "" })).toBe(false);
      expect(
        ok(transitionRequestSchema, { ...base, [field]: "a\u202eb" }),
      ).toBe(false);
      expect(
        ok(transitionRequestSchema, { ...base, [field]: "a".repeat(1001) }),
      ).toBe(false);
    }
  });
});

describe("correctionRequestSchema", () => {
  it("needs a state and a note of 1..1000 characters", () => {
    expect(
      ok(correctionRequestSchema, { expectedState: "planeado", note: "Fix" }),
    ).toBe(true);
    expect(
      ok(correctionRequestSchema, { expectedState: "planeado", note: " " }),
    ).toBe(false);
    expect(ok(correctionRequestSchema, { expectedState: "planeado" })).toBe(
      false,
    );
    expect(
      ok(correctionRequestSchema, { expectedState: "otro", note: "x" }),
    ).toBe(false);
    expect(
      correctionRequestSchema.parse({ expectedState: "planeado", note: " a\r\nb " })
        .note,
    ).toBe("a\nb");
  });
});

describe("publicDossierSchema", () => {
  it("accepts the hand-built fixture", () => {
    const result = publicDossierSchema.safeParse(buildDossier());
    expect(result.success).toBe(true);
  });

  it("rejects a dossier missing a required key", () => {
    for (const key of ["events", "milestones", "evidence", "snapshot", "comparison", "publication", "supportCount"]) {
      const broken: Record<string, unknown> = { ...buildDossier() };
      delete broken[key];
      expect(ok(publicDossierSchema, broken), key).toBe(false);
    }
  });

  it("rejects wrong enums and literals", () => {
    const cases: [string, (d: ReturnType<typeof buildDossier>) => void][] = [
      ["status", (d) => ((d as { status: string }).status = "aprobado")],
      ["scenario literal", (d) => ((d.publication as { scenario: string }).scenario = "real")],
      ["cost label", (d) => ((d.snapshot.cost as { label: string }).label = "official")],
      ["milestone status", (d) => ((d.milestones[0] as { status: string }).status = "hecho")],
      ["event kind", (d) => ((d.events[0] as { kind: string }).kind = "deleted")],
      ["reference surface", (d) => ((d.snapshot.analysis as { referenceSurface: string }).referenceSurface = "roof")],
      ["cost line status", (d) => ((d.snapshot.cost.lines[0] as { status: string }).status = "free")],
      ["site slug", (d) => (d.siteSlug = "Zocalo Puebla")],
      ["negative support", (d) => (d.supportCount = -1)],
      ["fractional support", (d) => (d.supportCount = 1.5)],
      ["bad uuid", (d) => (d.dossierId = "not-a-uuid")],
      ["bad date", (d) => (d.targetDate = "mañana")],
    ];
    for (const [name, mutate] of cases) {
      const d = buildDossier();
      mutate(d);
      expect(ok(publicDossierSchema, d), name).toBe(false);
    }
  });

  it("rejects an invalid feature and duplicate feature ids", () => {
    const badKind = buildDossier();
    (badKind.publication.features[0] as { kind: string }).kind = "parking_conversion";
    expect(ok(publicDossierSchema, badKind)).toBe(false);

    const duplicate = buildDossier();
    duplicate.publication.features[1].id = FIXTURE_IDS.canopy.toUpperCase();
    expect(ok(publicDossierSchema, duplicate)).toBe(false);

    const open = buildDossier();
    const ring = open.publication.features[0].geometry
      .coordinates as unknown as number[][][];
    ring[0][ring[0].length - 1] = [0, 0];
    expect(ok(publicDossierSchema, open)).toBe(false);
  });

  it("allows null amounts, null target date and null responsible", () => {
    const d = buildDossier();
    d.targetDate = null;
    d.responsibleName = null;
    d.snapshot.cost.currency = null;
    d.comparison.costDelta = null;
    expect(ok(publicDossierSchema, d)).toBe(true);
  });

  it("accepts every dossier status", () => {
    for (const status of ["en_revision", "planeado", "en_ejecucion", "ejecutado", "descartado"] as const) {
      const d = buildDossier();
      d.status = status;
      expect(ok(publicDossierSchema, d), status).toBe(true);
    }
  });
});

describe("managedDossierSchema", () => {
  const managed = () => {
    const d = buildDossier();
    return {
      dossierId: d.dossierId,
      publicationId: d.publicationId,
      siteId: d.siteId,
      status: d.status,
      moderationState: "visible",
      label: d.publication.label,
      decisionNote: d.decisionNote,
      responsibleName: d.responsibleName,
      targetDate: d.targetDate,
      updatedAt: d.updatedAt,
      milestones: d.milestones,
      evidence: d.evidence,
      events: d.events,
    };
  };

  it("accepts a managed projection built from the fixture", () => {
    expect(ok(managedDossierSchema, managed())).toBe(true);
    expect(ok(managedDossierSchema, { ...managed(), moderationState: "hidden" })).toBe(true);
  });

  it("rejects an unknown moderation state and missing keys", () => {
    expect(ok(managedDossierSchema, { ...managed(), moderationState: "deleted" })).toBe(false);
    const broken: Record<string, unknown> = managed();
    delete broken.events;
    expect(ok(managedDossierSchema, broken)).toBe(false);
  });
});

describe("dossierListSchema", () => {
  const item = {
    dossierId: UUID,
    publicationId: UUID,
    label: "Sombra",
    status: "planeado",
    updatedAt: "2026-05-10T18:30:00.000Z",
  };

  it("accepts an empty page and a page with a cursor", () => {
    expect(ok(dossierListSchema, { items: [], nextCursor: null })).toBe(true);
    expect(
      ok(dossierListSchema, {
        items: [item],
        nextCursor: { updatedAt: item.updatedAt, id: UUID },
      }),
    ).toBe(true);
  });

  it("rejects a bad status, a bad uuid and a missing cursor key", () => {
    expect(
      ok(dossierListSchema, { items: [{ ...item, status: "x" }], nextCursor: null }),
    ).toBe(false);
    expect(
      ok(dossierListSchema, { items: [{ ...item, dossierId: "1" }], nextCursor: null }),
    ).toBe(false);
    expect(ok(dossierListSchema, { items: [] })).toBe(false);
  });
});
