import { describe, expect, it } from "vitest";
import { mapCommunityError } from "@/lib/http/database-errors";
import {
  MAX_COMMENT_LENGTH,
  MAX_MODERATION_REASON_LENGTH,
  MAX_REPORT_NOTE_LENGTH,
  commentPageSchema,
  createCommentRequestSchema,
  createReportRequestSchema,
  decodeCursor,
  encodeCursor,
  hiddenContentSchema,
  hiddenMineSchema,
  moderationActionRequestSchema,
  moderationTargetSchema,
  openReportsPageSchema,
  plainText,
  publicCommentSchema,
  resolveReportRequestSchema,
} from "@/lib/schemas/community";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

describe("plainText", () => {
  const schema = plainText(1, 10);

  it("normaliza CRLF y CR a LF y recorta los bordes", () => {
    expect(schema.parse("  a\r\nb\rc \n")).toBe("a\nb\nc");
  });

  it("conserva los saltos de línea internos", () => {
    expect(schema.parse("a\n\nb")).toBe("a\n\nb");
  });

  it("rechaza vacío o solo espacios", () => {
    expect(schema.safeParse("").success).toBe(false);
    expect(schema.safeParse("  \n\t ").success).toBe(false);
  });

  it("aplica el máximo después de recortar y normalizar", () => {
    expect(schema.safeParse("a".repeat(10)).success).toBe(true);
    expect(schema.safeParse("a".repeat(11)).success).toBe(false);
    expect(schema.safeParse(` ${"a".repeat(10)} `).success).toBe(true);
    // Cada CRLF cuenta como 1 carácter tras normalizar: 4×"a\n" + "bb" = 10.
    expect(schema.safeParse("a\r\n".repeat(4) + "bb").success).toBe(true);
    expect(schema.safeParse("a\r\n".repeat(4) + "bbb").success).toBe(false);
  });

  it.each([
    ["NUL", "a\u0000b"],
    ["tabulación", "a\tb"],
    ["escape", "a\u001Bb"],
    ["DEL", "a\u007Fb"],
    ["C1", "a\u0085b"],
    ["LRE", "a\u202Ab"],
    ["RLO", "a\u202Eb"],
    ["LRI", "a\u2066b"],
    ["PDI", "a\u2069b"],
  ])("rechaza el carácter de control o bidi: %s", (_name, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("acepta acentos, emoji y marcas de HTML como texto literal", () => {
    expect(schema.parse("<b>ñ😀")).toBe("<b>ñ😀");
  });

  it("rechaza valores que no son texto", () => {
    expect(schema.safeParse(5).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });
});

describe("createCommentRequestSchema", () => {
  it("acepta cuerpo y ancla opcional", () => {
    expect(createCommentRequestSchema.parse({ body: " Hola " })).toEqual({
      body: "Hola",
    });
    expect(
      createCommentRequestSchema.parse({ body: "Hola", featureId: ID_A }),
    ).toEqual({ body: "Hola", featureId: ID_A });
    expect(
      createCommentRequestSchema.parse({ body: "Hola", featureId: null }),
    ).toEqual({ body: "Hola", featureId: null });
  });

  it("respeta el máximo de 1000 caracteres", () => {
    expect(MAX_COMMENT_LENGTH).toBe(1000);
    expect(
      createCommentRequestSchema.safeParse({ body: "a".repeat(1000) }).success,
    ).toBe(true);
    expect(
      createCommentRequestSchema.safeParse({ body: "a".repeat(1001) }).success,
    ).toBe(false);
  });

  it("rechaza cuerpo vacío, con control o ausente", () => {
    expect(createCommentRequestSchema.safeParse({ body: "   " }).success).toBe(
      false,
    );
    expect(
      createCommentRequestSchema.safeParse({ body: "a\u0007b" }).success,
    ).toBe(false);
    expect(createCommentRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rechaza claves extra y featureId que no es UUID", () => {
    expect(
      createCommentRequestSchema.safeParse({ body: "x", extra: 1 }).success,
    ).toBe(false);
    expect(
      createCommentRequestSchema.safeParse({ body: "x", authorId: ID_A })
        .success,
    ).toBe(false);
    expect(
      createCommentRequestSchema.safeParse({ body: "x", featureId: "abc" })
        .success,
    ).toBe(false);
  });
});

describe("createReportRequestSchema", () => {
  const valid = { targetKind: "comment", targetId: ID_A, reason: "spam" };

  it("acepta todos los motivos y ambos tipos de objetivo", () => {
    for (const reason of [
      "spam",
      "harassment",
      "misinformation",
      "privacy",
      "other",
    ]) {
      expect(
        createReportRequestSchema.safeParse({ ...valid, reason }).success,
      ).toBe(true);
    }
    expect(
      createReportRequestSchema.safeParse({
        ...valid,
        targetKind: "publication",
      }).success,
    ).toBe(true);
  });

  it("la nota es opcional, admite null y se recorta", () => {
    expect(createReportRequestSchema.parse(valid).note).toBeUndefined();
    expect(createReportRequestSchema.parse({ ...valid, note: null }).note).toBe(
      null,
    );
    expect(
      createReportRequestSchema.parse({ ...valid, note: "  hola \r\n" }).note,
    ).toBe("hola");
  });

  it("limita la nota a 500 caracteres y rechaza vacía", () => {
    expect(MAX_REPORT_NOTE_LENGTH).toBe(500);
    expect(
      createReportRequestSchema.safeParse({
        ...valid,
        note: "a".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      createReportRequestSchema.safeParse({ ...valid, note: "" }).success,
    ).toBe(false);
  });

  it("rechaza motivo o tipo desconocido, id inválido y claves extra", () => {
    expect(
      createReportRequestSchema.safeParse({ ...valid, reason: "odio" }).success,
    ).toBe(false);
    expect(
      createReportRequestSchema.safeParse({ ...valid, targetKind: "site" })
        .success,
    ).toBe(false);
    expect(
      createReportRequestSchema.safeParse({ ...valid, targetId: "x" }).success,
    ).toBe(false);
    expect(
      createReportRequestSchema.safeParse({ ...valid, extra: true }).success,
    ).toBe(false);
  });
});

describe("moderationActionRequestSchema", () => {
  const valid = {
    targetKind: "publication",
    targetId: ID_A,
    action: "hide",
    reason: "Spam evidente",
  };

  it("acepta hide y restore con campos opcionales", () => {
    expect(moderationActionRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      moderationActionRequestSchema.safeParse({
        ...valid,
        action: "restore",
        privateNote: " nota ",
        reportId: ID_B,
      }),
    ).toMatchObject({ success: true, data: { privateNote: "nota" } });
    expect(
      moderationActionRequestSchema.safeParse({
        ...valid,
        privateNote: null,
        reportId: null,
      }).success,
    ).toBe(true);
  });

  it("exige motivo no vacío de hasta 500", () => {
    expect(MAX_MODERATION_REASON_LENGTH).toBe(500);
    expect(
      moderationActionRequestSchema.safeParse({ ...valid, reason: " " })
        .success,
    ).toBe(false);
    expect(
      moderationActionRequestSchema.safeParse({
        ...valid,
        reason: "a".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      moderationActionRequestSchema.safeParse({
        ...valid,
        reason: "a".repeat(500),
      }).success,
    ).toBe(true);
  });

  it("rechaza acción desconocida, reportId inválido y claves extra", () => {
    expect(
      moderationActionRequestSchema.safeParse({ ...valid, action: "delete" })
        .success,
    ).toBe(false);
    expect(
      moderationActionRequestSchema.safeParse({ ...valid, reportId: "x" })
        .success,
    ).toBe(false);
    expect(
      moderationActionRequestSchema.safeParse({ ...valid, extra: 1 }).success,
    ).toBe(false);
  });
});

describe("resolveReportRequestSchema", () => {
  it("dismissed exige note", () => {
    expect(
      resolveReportRequestSchema.safeParse({
        outcome: "dismissed",
        note: " No aplica ",
      }),
    ).toMatchObject({
      success: true,
      data: { outcome: "dismissed", note: "No aplica" },
    });
    expect(
      resolveReportRequestSchema.safeParse({ outcome: "dismissed" }).success,
    ).toBe(false);
  });

  it("actioned exige eventId UUID", () => {
    expect(
      resolveReportRequestSchema.safeParse({
        outcome: "actioned",
        eventId: ID_A,
      }).success,
    ).toBe(true);
    expect(
      resolveReportRequestSchema.safeParse({ outcome: "actioned" }).success,
    ).toBe(false);
    expect(
      resolveReportRequestSchema.safeParse({
        outcome: "actioned",
        eventId: "x",
      }).success,
    ).toBe(false);
  });

  it("no mezcla campos de ambas ramas ni acepta otros resultados", () => {
    expect(
      resolveReportRequestSchema.safeParse({
        outcome: "actioned",
        eventId: ID_A,
        note: "x",
      }).success,
    ).toBe(false);
    expect(
      resolveReportRequestSchema.safeParse({
        outcome: "dismissed",
        note: "x",
        eventId: ID_A,
      }).success,
    ).toBe(false);
    expect(
      resolveReportRequestSchema.safeParse({ outcome: "open", note: "x" })
        .success,
    ).toBe(false);
    expect(resolveReportRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("encodeCursor / decodeCursor", () => {
  it("ida y vuelta conserva microsegundos y desfase", () => {
    for (const createdAt of [
      "2026-05-01T12:34:56.123456+00:00",
      "2026-05-01T12:34:56.1Z",
      "2026-05-01T12:34:56Z",
      "2026-05-01T12:34:56.000001-06:00",
    ]) {
      const encoded = encodeCursor({ createdAt, id: ID_A });
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(encoded)).toEqual({ createdAt, id: ID_A });
    }
  });

  it("null y cadena vacía significan primera página", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("rechaza basura, base64 inválido y formatos cercanos", () => {
    const b64 = (text: string) => Buffer.from(text).toString("base64url");
    for (const value of [
      "!!!",
      "abc",
      b64("no-es-cursor"),
      b64(`2026-05-01|${ID_A}`),
      b64(`2026-05-01T12:34:56.1234567Z|${ID_A}`),
      b64(`2026-05-01T12:34:56Z|not-a-uuid`),
      b64(`2026-05-01T12:34:56Z|${"z".repeat(36)}`),
      b64(`2026-05-01T12:34:56Z|${ID_A}|extra`),
      b64(`2026-05-01T12:34:56 |${ID_A}`),
    ]) {
      expect(decodeCursor(value), value).toBe("invalid");
    }
  });

  it("rechaza cursores de más de 120 caracteres", () => {
    expect(decodeCursor("a".repeat(121))).toBe("invalid");
  });
});

describe("esquemas de respuesta", () => {
  const comment = {
    commentId: ID_A,
    body: "Hola",
    authorAlias: "vecina",
    createdAt: "2026-05-01T12:00:00+00:00",
    mine: false,
    anchor: null,
  };

  it("publicCommentSchema exige mine booleano y admite ancla", () => {
    expect(publicCommentSchema.safeParse(comment).success).toBe(true);
    expect(
      publicCommentSchema.safeParse({
        ...comment,
        mine: true,
        anchor: { featureId: ID_B, label: null },
      }).success,
    ).toBe(true);
    const { mine, ...withoutMine } = comment;
    void mine;
    expect(publicCommentSchema.safeParse(withoutMine).success).toBe(false);
    expect(
      publicCommentSchema.safeParse({ ...comment, mine: "yes" }).success,
    ).toBe(false);
  });

  it("publicCommentSchema descarta campos que identificarían a la persona", () => {
    const parsed = publicCommentSchema.parse({
      ...comment,
      authorId: ID_C,
      email: "a@b.mx",
    });
    expect(parsed).not.toHaveProperty("authorId");
    expect(parsed).not.toHaveProperty("email");
  });

  it("commentPageSchema valida items y nextCursor", () => {
    expect(
      commentPageSchema.safeParse({ items: [comment], nextCursor: null })
        .success,
    ).toBe(true);
    expect(
      commentPageSchema.safeParse({
        items: [],
        nextCursor: { createdAt: "2026-05-01T12:00:00+00:00", id: ID_A },
      }).success,
    ).toBe(true);
    expect(commentPageSchema.safeParse({ items: [comment] }).success).toBe(
      false,
    );
    expect(
      commentPageSchema.safeParse({
        items: [{ ...comment, commentId: "x" }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  it("openReportsPageSchema valida un reporte", () => {
    const report = {
      reportId: ID_A,
      targetKind: "comment",
      publicationId: ID_B,
      commentId: ID_C,
      reason: "spam",
      note: null,
      reporterAlias: "vecina",
      targetState: "visible",
      preview: "texto",
      createdAt: "2026-05-01T12:00:00+00:00",
    };
    expect(
      openReportsPageSchema.safeParse({ items: [report], nextCursor: null })
        .success,
    ).toBe(true);
    expect(
      openReportsPageSchema.safeParse({
        items: [{ ...report, reason: "otro" }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      openReportsPageSchema.safeParse({
        items: [{ ...report, targetState: "deleted" }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  it("moderationTargetSchema valida historial y estados", () => {
    const target = {
      targetKind: "comment",
      targetId: ID_A,
      siteId: ID_B,
      publicationId: ID_C,
      state: "hidden",
      authorAlias: "vecina",
      createdAt: "2026-05-01T12:00:00+00:00",
      openReports: 2,
      history: [
        {
          eventId: ID_A,
          action: "hide",
          reason: "spam",
          privateNote: null,
          actorAlias: "mod",
          createdAt: "2026-05-01T12:00:00+00:00",
        },
      ],
    };
    expect(moderationTargetSchema.safeParse(target).success).toBe(true);
    expect(
      moderationTargetSchema.safeParse({ ...target, openReports: -1 }).success,
    ).toBe(false);
    expect(
      moderationTargetSchema.safeParse({
        ...target,
        history: [{ ...target.history[0], action: "delete" }],
      }).success,
    ).toBe(false);
  });

  it("hiddenContentSchema valida elementos ocultos", () => {
    const item = {
      targetKind: "publication",
      targetId: ID_A,
      publicationId: ID_A,
      commentId: null,
      preview: null,
      reason: "spam",
      hiddenAt: "2026-05-01T12:00:00+00:00",
    };
    expect(hiddenContentSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(
      hiddenContentSchema.safeParse({ items: [{ ...item, reason: undefined }] })
        .success,
    ).toBe(false);
  });
});

describe("mapCommunityError", () => {
  it("28000 → 401 authentication_required", () => {
    expect(mapCommunityError({ code: "28000" })).toMatchObject({
      status: 401,
      code: "authentication_required",
    });
  });

  it.each([
    ["publication_not_found"],
    ["target_not_found"],
    ["comment_not_found"],
    ["site_not_found"],
    ["report_not_found"],
  ])("P0002 con mensaje %s → 404 con ese código", (message) => {
    expect(mapCommunityError({ code: "P0002", message })).toMatchObject({
      status: 404,
      code: message,
    });
  });

  it("P0002 con mensaje desconocido o ausente → 404 not_found", () => {
    expect(mapCommunityError({ code: "P0002", message: "otra" })).toMatchObject(
      { status: 404, code: "not_found" },
    );
    expect(mapCommunityError({ code: "P0002" })).toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  // DEFECTO CONOCIDO: `error.message in communityNotFound` (database-errors.ts) también
  // acepta claves del prototipo ("toString", "constructor"), y el código público
  // sería ese texto en vez de "not_found". Cuando se corrija, quitar `.fails`.
  it("P0002 con un nombre del prototipo no se toma como código conocido", () => {
    expect(
      mapCommunityError({ code: "P0002", message: "toString" }),
    ).toMatchObject({ status: 404, code: "not_found" });
  });

  it("FT001 → 409 idempotency_conflict", () => {
    expect(mapCommunityError({ code: "FT001" })).toMatchObject({
      status: 409,
      code: "idempotency_conflict",
    });
  });

  it("FT409 usa el mensaje conocido o conflict", () => {
    expect(
      mapCommunityError({
        code: "FT409",
        message: "moderation_state_unchanged",
      }),
    ).toMatchObject({ status: 409, code: "moderation_state_unchanged" });
    expect(
      mapCommunityError({ code: "FT409", message: "report_already_resolved" }),
    ).toMatchObject({ status: 409, code: "report_already_resolved" });
    expect(mapCommunityError({ code: "FT409", message: "otra" })).toMatchObject(
      { status: 409, code: "conflict" },
    );
    expect(mapCommunityError({ code: "FT409" })).toMatchObject({
      status: 409,
      code: "conflict",
    });
  });

  it("FT422 y 23503 → 422 con el código adecuado", () => {
    expect(
      mapCommunityError({ code: "FT422", message: "invalid_anchor" }),
    ).toMatchObject({ status: 422, code: "invalid_anchor" });
    expect(
      mapCommunityError({ code: "FT422", message: "report_mismatch" }),
    ).toMatchObject({ status: 422, code: "report_mismatch" });
    expect(mapCommunityError({ code: "FT422", message: "otra" })).toMatchObject(
      { status: 422, code: "invalid_request" },
    );
    expect(mapCommunityError({ code: "FT422" })).toMatchObject({
      status: 422,
      code: "invalid_request",
    });
    expect(
      mapCommunityError({ code: "23503", message: "cualquiera" }),
    ).toMatchObject({ status: 422, code: "invalid_anchor" });
  });

  it("FT429 lee los segundos de DETAIL y envía Retry-After", () => {
    expect(mapCommunityError({ code: "FT429", details: "1234" })).toEqual({
      status: 429,
      code: "rate_limited",
      message: expect.any(String),
      details: { retryAfterSeconds: 1234 },
      headers: { "Retry-After": "1234" },
    });
  });

  it("FT429 sin DETAIL, vacío o no numérico usa 60", () => {
    for (const details of [undefined, null, "", "abc"]) {
      const mapped = mapCommunityError({ code: "FT429", details });
      expect(mapped?.details).toEqual({ retryAfterSeconds: 60 });
      expect(mapped?.headers).toEqual({ "Retry-After": "60" });
    }
  });

  it("FT429 con 0 o negativo → 60 o 1 según la regla (mínimo 1)", () => {
    // "0" se trata como ausente (|| 60); un negativo se eleva a 1.
    expect(mapCommunityError({ code: "FT429", details: "0" })?.details).toEqual(
      { retryAfterSeconds: 60 },
    );
    expect(
      mapCommunityError({ code: "FT429", details: "-5" })?.details,
    ).toEqual({ retryAfterSeconds: 1 });
    expect(
      mapCommunityError({ code: "FT429", details: "7 seconds" })?.details,
    ).toEqual({ retryAfterSeconds: 7 });
  });

  it("22023 → 422 invalid_request", () => {
    expect(mapCommunityError({ code: "22023" })).toMatchObject({
      status: 422,
      code: "invalid_request",
    });
  });

  it("códigos desconocidos o ausentes → null", () => {
    expect(mapCommunityError({ code: "XX000" })).toBeNull();
    expect(mapCommunityError({ code: "42501" })).toBeNull();
    expect(mapCommunityError({})).toBeNull();
    expect(mapCommunityError({ code: null })).toBeNull();
  });
});
describe("caracteres invisibles (migración 20261124070000)", () => {
  const invisibles: Array<[string, string]> = [
    ["U+200B espacio de ancho cero", "\u200B"],
    ["U+200C", "\u200C"],
    ["U+200F marca RTL", "\u200F"],
    ["U+FEFF", "\uFEFF"],
    ["U+2028 separador de línea", "\u2028"],
    ["U+00AD guion blando", "\u00AD"],
    ["U+061C marca de letra árabe", "\u061C"],
    ["U+2060 unión de palabras", "\u2060"],
    ["U+2064", "\u2064"],
    ["U+2069", "\u2069"],
  ];
  it.each(invisibles)("rechaza %s dentro de comentario, nota y motivo", (_n, ch) => {
    const text = `a${ch}b`;
    expect(createCommentRequestSchema.safeParse({ body: text }).success).toBe(
      false,
    );
    expect(
      moderationActionRequestSchema.safeParse({
        targetKind: "publication",
        targetId: ID_A,
        action: "hide",
        reason: text,
      }).success,
    ).toBe(false);
    expect(
      moderationActionRequestSchema.safeParse({
        targetKind: "publication",
        targetId: ID_A,
        action: "hide",
        reason: "Motivo válido",
        privateNote: text,
      }).success,
    ).toBe(false);
    expect(
      createReportRequestSchema.safeParse({
        targetKind: "publication",
        targetId: ID_A,
        reason: "spam",
        note: text,
      }).success,
    ).toBe(false);
  });
  it("un comentario solo de caracteres invisibles se rechaza", () => {
    expect(
      createCommentRequestSchema.safeParse({ body: "\u200B\u200B" }).success,
    ).toBe(false);
  });
  it("sigue aceptando texto normal con acentos y espacio fino U+200A", () => {
    expect(
      createCommentRequestSchema.safeParse({ body: "ñandú\u200Acafé" }).success,
    ).toBe(true);
  });
});
describe("hiddenMineSchema", () => {
  const item = {
    publicationId: ID_A,
    label: "Propuesta",
    reason: "Datos personales",
    hiddenAt: "2026-05-01T12:00:00+00:00",
  };
  it("valida una lista de publicaciones ocultas propias", () => {
    expect(hiddenMineSchema.parse({ items: [item] }).items).toHaveLength(1);
    expect(hiddenMineSchema.parse({ items: [] }).items).toEqual([]);
  });
  it("rechaza elementos incompletos o con id inválido", () => {
    expect(
      hiddenMineSchema.safeParse({ items: [{ ...item, reason: undefined }] })
        .success,
    ).toBe(false);
    expect(
      hiddenMineSchema.safeParse({ items: [{ ...item, publicationId: "x" }] })
        .success,
    ).toBe(false);
    expect(hiddenMineSchema.safeParse({}).success).toBe(false);
  });
  it("descarta campos privados que no forman parte del contrato", () => {
    const parsed = hiddenMineSchema.parse({
      items: [{ ...item, privateNote: "secreto", actorId: ID_B, reporterId: ID_C }],
    });
    expect(Object.keys(parsed.items[0]).sort()).toEqual([
      "hiddenAt",
      "label",
      "publicationId",
      "reason",
    ]);
  });
});
