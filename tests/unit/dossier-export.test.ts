import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DOSSIER_HTML_STYLES,
  buildAssumptionsJson,
  buildCostCsv,
  buildDossierHtml,
  buildPreviewSvg,
  escapeHtml,
} from "@/lib/format/dossier-export";
import { parseCsv } from "@/lib/format/csv";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  FIXTURE_IDS,
  PILOT_BOUNDARY,
  PILOT_BOUNDS,
  buildDossier,
} from "../fixtures/dossier";

/** Seed for every property test in this file: 20260514. */
const SEED = 20260514;
const RUNS = 500;
const NOW = new Date("2026-06-01T12:34:56.000Z");

const HEADER = [
  "concept",
  "code",
  "unit",
  "quantity",
  "formula",
  "status",
  "amount_low",
  "amount_high",
  "currency",
  "is_assumption",
  "assumption_owner",
  "assumption_date",
  "budget_label",
  "catalog_source",
  "price_date",
  "rounding",
  "scenario",
  "generated_at",
];

describe("escapeHtml", () => {
  const decode = (value: string) =>
    value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");

  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<a href="x" t='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; t=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml("texto normal ñ 🌳")).toBe("texto normal ñ 🌳");
  });

  it("does not double-decode: &amp;lt; stays text", () => {
    expect(decode(escapeHtml("&lt;"))).toBe("&lt;");
  });

  it("never emits raw < > \" ' and every & starts an entity (seed 20260514)", () => {
    const input = fc.oneof(
      fc.string({ unit: "binary", maxLength: 40 }),
      fc.string({ maxLength: 40 }),
      fc
        .array(fc.constantFrom("<", ">", '"', "'", "&", "&amp;", "&lt;", "a"), {
          maxLength: 20,
        })
        .map((parts) => parts.join("")),
    );
    fc.assert(
      fc.property(input, (value) => {
        const out = escapeHtml(value);
        expect(out).not.toMatch(/[<>"']/);
        expect(out.replace(/&(?:amp|lt|gt|quot|#39);/g, "")).not.toContain("&");
        expect(decode(out)).toBe(value);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

describe("buildCostCsv", () => {
  const dossier = buildDossier();
  const csv = buildCostCsv(dossier, NOW);
  const rows = parseCsv(csv);

  it("starts with a BOM and uses CRLF line endings only", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).not.toContain("\ufeff");
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("names exactly the 18 columns in order", () => {
    expect(rows[0]).toEqual(HEADER);
    expect(rows[0]).toHaveLength(18);
  });

  it("has one row per line plus a TOTAL row, each with 18 cells", () => {
    expect(rows).toHaveLength(1 + dossier.snapshot.cost.lines.length + 1);
    for (const row of rows) expect(row).toHaveLength(18);
    expect(rows.at(-1)?.[0]).toBe("TOTAL");
  });

  it("writes amounts as cents / 100 with two decimals and empty for null", () => {
    const col = (name: string) => HEADER.indexOf(name);
    expect(rows[1][col("amount_low")]).toBe("123456.00");
    expect(rows[1][col("amount_high")]).toBe("180000.50");
    expect(rows[1][col("quantity")]).toBe("120.50");
    expect(rows[2][col("amount_low")]).toBe("");
    expect(rows[2][col("amount_high")]).toBe("");
    expect(rows[2][col("status")]).toBe("unpriced");
    expect(rows[2][col("code")]).toBe("");
    const total = rows.at(-1)!;
    expect(total[col("amount_low")]).toBe("123456.00");
    expect(total[col("amount_high")]).toBe("180000.50");
    expect(total[col("quantity")]).toBe("");
    expect(total[col("status")]).toBe("total_partial");
  });

  it("marks assumptions and total status", () => {
    expect(rows[1][HEADER.indexOf("is_assumption")]).toBe("true");
    expect(rows[1][HEADER.indexOf("assumption_owner")]).toBe(
      "equipo_evaluacion",
    );
    expect(rows[2][HEADER.indexOf("is_assumption")]).toBe("false");
    const complete = buildDossier();
    complete.snapshot.cost.partial = false;
    const completeRows = parseCsv(buildCostCsv(complete, NOW));
    expect(completeRows.at(-1)?.[HEADER.indexOf("status")]).toBe("total");
  });

  it("repeats currency, budget label, source, price date, rounding, scenario and ISO time on every row", () => {
    const col = (name: string) => HEADER.indexOf(name);
    for (const row of rows.slice(1)) {
      expect(row[col("currency")]).toBe("MXN");
      expect(row[col("budget_label")]).toBe("fully_illustrative");
      expect(row[col("catalog_source")]).toBe("Catálogo de evaluación Zócalo v1");
      expect(row[col("price_date")]).toBe("2026-04-01");
      expect(row[col("rounding")]).toBe("Redondeo half-up a centavos por línea.");
      expect(row[col("scenario")]).toBe("summer-solstice-noon");
      expect(row[col("generated_at")]).toBe(NOW.toISOString());
      expect(new Date(row[col("generated_at")]).toISOString()).toBe(
        row[col("generated_at")],
      );
    }
  });

  it("neutralizes formula payloads in user-controlled text cells", () => {
    const hostile = buildDossier();
    hostile.snapshot.cost.lines[0].concept = '=HYPERLINK("http://x")';
    hostile.snapshot.cost.lines[0].code = "+cmd";
    hostile.snapshot.cost.lines[0].assumptionOwner = "@SUM(1)";
    hostile.snapshot.cost.lines[0].formula = "-2+3";
    hostile.snapshot.cost.lines[1].unit = "\t=1";
    hostile.snapshot.cost.source = "  =evil()";
    const out = parseCsv(buildCostCsv(hostile, NOW));
    const col = (name: string) => HEADER.indexOf(name);
    expect(out[1][col("concept")]).toBe(`'=HYPERLINK("http://x")`);
    expect(out[1][col("code")]).toBe("'+cmd");
    expect(out[1][col("assumption_owner")]).toBe("'@SUM(1)");
    expect(out[1][col("formula")]).toBe("'-2+3");
    expect(out[2][col("unit")]).toBe("'\t=1");
    expect(out[1][col("catalog_source")]).toBe("'  =evil()");
    // No text cell of any row starts with a trigger once leading blanks are skipped.
    for (const row of out.slice(1)) {
      row.forEach((cell, index) => {
        if (["quantity", "amount_low", "amount_high"].includes(HEADER[index]))
          return;
        expect(cell).not.toMatch(/^[^\S\t\r\n]*[=+\-@\t\r\n＝＋－＠]/);
      });
    }
  });

  it("keeps a negative amount numeric and un-quoted", () => {
    const negative = buildDossier();
    negative.snapshot.cost.lines[0].amountLowCents = -500;
    const text = buildCostCsv(negative, NOW);
    expect(text).toContain(",-5.00,");
    expect(parseCsv(text)[1][HEADER.indexOf("amount_low")]).toBe("-5.00");
  });
});

describe("buildAssumptionsJson", () => {
  const dossier = buildDossier();
  const json = buildAssumptionsJson(dossier, NOW);

  it("has schema version, ids, scenario, engine and ISO time", () => {
    expect(json.schemaVersion).toBe(1);
    expect(json.dossierId).toBe(FIXTURE_IDS.dossier);
    expect(json.publicationId).toBe(FIXTURE_IDS.publication);
    expect(json.scenario).toEqual(dossier.snapshot.scenario);
    expect(json.engine).toEqual({
      version: "analysis-v1",
      generator: "scripts/generate-solar-scenarios.mjs",
      datasetChecksum: "sha256:abc123",
    });
    expect(json.generatedAt).toBe(NOW.toISOString());
    expect(json.currency).toBe("MXN");
    expect(json.budgetLabel).toBe("fully_illustrative");
    expect(json.partial).toBe(true);
    expect(json.unknownConcepts).toEqual(["temporary_market"]);
  });

  it("lists assumptions only for lines flagged isAssumption", () => {
    expect(json.assumptions).toEqual([
      {
        code: "CAN-01",
        concept: "shade_canopy",
        owner: "equipo_evaluacion",
        date: "2026-04-01",
      },
    ]);
  });

  it("uses null for missing optional catalog fields", () => {
    const bare = buildDossier();
    delete bare.snapshot.cost.source;
    delete bare.snapshot.cost.priceDate;
    delete bare.snapshot.cost.rounding;
    const out = buildAssumptionsJson(bare, NOW);
    expect(out.catalog.source).toBeNull();
    expect(out.catalog.priceDate).toBeNull();
    expect(out.rounding).toBeNull();
  });

  it("is JSON serializable without loss", () => {
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe("buildPreviewSvg", () => {
  const bounds = PILOT_BOUNDS;
  const svg = buildPreviewSvg(buildDossier(), PILOT_BOUNDARY, bounds, "Vista");

  it("draws the boundary plus one shape per feature", () => {
    expect((svg.match(/<polygon/g) ?? []).length).toBe(1 + 2);
  });

  it("draws points as circles and lines as polylines", () => {
    const dossier = buildDossier();
    dossier.publication.features.push(
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "shade_tree",
        properties: { label: "Árbol", canopyDiameterM: 5, heightM: 6 },
        geometry: { type: "Point", coordinates: [-98.198, 19.0436] },
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "proposed_crossing",
        properties: { label: "Cruce", widthM: 3 },
        geometry: {
          type: "LineString",
          coordinates: [
            [-98.1985, 19.0432],
            [-98.1975, 19.0441],
          ],
        },
      },
    );
    const out = buildPreviewSvg(dossier, PILOT_BOUNDARY, bounds, "Vista");
    expect((out.match(/<circle/g) ?? []).length).toBe(1);
    expect((out.match(/<polyline/g) ?? []).length).toBe(1);
    expect((out.match(/<polygon/g) ?? []).length).toBe(3);
  });

  it("uses presentation attributes and no inline style attribute", () => {
    expect(svg).not.toContain('style="');
    expect(svg).toMatch(/\bfill="/);
    expect(svg).toMatch(/\bstroke="/);
  });

  it("has no script or event handler and escapes the aria-label", () => {
    expect(svg).not.toContain("<script");
    const hostile = buildPreviewSvg(
      buildDossier(),
      PILOT_BOUNDARY,
      bounds,
      `"><script>alert(1)</script>`,
    );
    expect(hostile).not.toContain("<script");
    expect(hostile).toContain(
      'aria-label="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
    );
    const doc = new DOMParser().parseFromString(hostile, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(0);
  });
});

describe("DOSSIER_HTML_STYLES", () => {
  it("is non-empty and safe to inline under a strict CSP", () => {
    expect(typeof DOSSIER_HTML_STYLES).toBe("string");
    expect(DOSSIER_HTML_STYLES.trim().length).toBeGreaterThan(0);
    expect(DOSSIER_HTML_STYLES).not.toMatch(/<\/style/i);
    expect(DOSSIER_HTML_STYLES).not.toMatch(/@import/i);
    expect(DOSSIER_HTML_STYLES).not.toMatch(/url\(/i);
    expect(DOSSIER_HTML_STYLES).toContain("@media print");
  });
});

describe("buildDossierHtml", () => {
  type Locale = "es" | "en";
  const render = (
    dossier = buildDossier(),
    locale: Locale = "es",
    svg?: string,
  ) => {
    const messages = locale === "es" ? es : en;
    return buildDossierHtml({
      dossier,
      locale,
      copy: messages.dossier as unknown as typeof es.dossier,
      kinds: messages.editor.kinds as unknown as typeof es.editor.kinds,
      previewSvg:
        svg ?? buildPreviewSvg(dossier, PILOT_BOUNDARY, PILOT_BOUNDS, "Vista"),
      siteName: "Zócalo de Puebla",
      generatedAt: NOW,
    });
  };
  const parse = (html: string) =>
    new DOMParser().parseFromString(html, "text/html");

  const XSS_TAG = "<script>alert(1)</script>";
  const XSS_ATTR = `"><img src=x onerror=alert(1)>`;

  it("sets the lang attribute from the locale", () => {
    expect(render(buildDossier(), "es")).toContain('<html lang="es">');
    expect(render(buildDossier(), "en")).toContain('<html lang="en">');
  });

  it("contains no script tag in a normal render", () => {
    const html = render();
    expect(html).not.toMatch(/<script/i);
    expect(parse(html).querySelectorAll("script")).toHaveLength(0);
  });

  it("shows the hypothetical notice and budget label in both languages", () => {
    const html = render();
    expect(html).toContain(escapeHtml(es.dossier.hypothetical));
    expect(html).toContain(escapeHtml(es.dossier.costLabels.fully_illustrative));
    const htmlEn = render(buildDossier(), "en");
    expect(htmlEn).toContain(escapeHtml(en.dossier.hypothetical));
    expect(htmlEn).toContain(
      escapeHtml(en.dossier.costLabels.fully_illustrative),
    );
  });

  it("localizes the status", () => {
    expect(render(buildDossier(), "es")).toContain("Planeado");
    const english = render(buildDossier(), "en");
    expect(english).toContain("Planned");
    expect(english).not.toContain("Planeado");
  });

  it("has no inline style attribute and keeps presentation attributes in the SVG", () => {
    const html = render();
    expect(html).not.toContain('style="');
    expect(html).toMatch(/<svg\b[^>]*>/);
    expect(html).toMatch(/\bfill="/);
    expect(html).toMatch(/\bstroke="/);
  });

  it("includes the print rule and an inline stylesheet only", () => {
    const html = render();
    expect(html).toContain("@media print");
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it("lists milestones, timeline entries and corrections", () => {
    const doc = parse(render());
    const body = doc.body.textContent ?? "";
    expect(body).toContain("Consulta vecinal");
    expect(body).toContain("Prueba piloto");
    expect(body).toContain(es.dossier.milestoneStatus.cumplido);
    expect(body).toContain(es.dossier.milestoneStatus.pendiente);
    const items = doc.querySelectorAll("ol > li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain(es.dossier.eventKinds.promoted);
    expect(items[1].textContent).toContain(es.dossier.eventKinds.status_change);
    expect(items[1].textContent).toContain("Hay responsable e hito.");
    expect(items[2].textContent).toContain(es.dossier.eventKinds.correction);
    expect(items[2].textContent).toContain("Se corrige la fecha del acta.");
  });

  it("shows empty states when there are no milestones or evidence", () => {
    const empty = buildDossier();
    empty.milestones = [];
    empty.evidence = [];
    const body = parse(render(empty)).body.textContent ?? "";
    expect(body).toContain(es.dossier.milestonesEmpty);
    expect(body).toContain(es.dossier.evidenceEmpty);
  });

  it("renders unpriced lines with the unpriced label and shows the assumption tag", () => {
    const body = parse(render()).body.textContent ?? "";
    expect(body).toContain(es.dossier.unpriced);
    expect(body).toContain("equipo_evaluacion");
  });

  it("evidence links have noopener and noreferrer, open https, and show the host", () => {
    const doc = parse(render());
    const link = doc.querySelector<HTMLAnchorElement>("li a[href]");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(
      "https://colectivo.example.org/acta?b=c#d",
    );
    const rel = link?.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(doc.body.textContent).toContain("colectivo.example.org");
  });

  it("escapes hostile text in every dynamic field", () => {
    const hostile = buildDossier();
    hostile.publication.label = XSS_TAG;
    hostile.publication.summary = XSS_ATTR;
    hostile.publication.authorAlias = XSS_TAG;
    hostile.decisionNote = XSS_ATTR;
    hostile.responsibleName = XSS_ATTR;
    hostile.publication.features[0].properties.label = XSS_TAG;
    hostile.evidence[0].title = XSS_TAG;
    hostile.evidence[0].description = XSS_ATTR;
    hostile.evidence[0].recordedByAlias = XSS_ATTR;
    hostile.evidence[0].verifiedByAlias = XSS_TAG;
    hostile.evidence[0].host = XSS_ATTR;
    hostile.milestones[0].title = XSS_TAG;
    hostile.events[1].note = XSS_ATTR;
    hostile.events[1].actorAlias = XSS_TAG;
    hostile.events[0].observation = XSS_TAG;
    hostile.events[0].difference = XSS_ATTR;
    hostile.snapshot.cost.source = XSS_TAG;
    hostile.snapshot.cost.lines[0].assumptionOwner = XSS_ATTR;
    hostile.snapshot.scenario.slug = XSS_ATTR;
    const html = render(hostile, "es", "");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain(`"><img`);

    const doc = parse(html);
    expect(doc.querySelectorAll("script, img")).toHaveLength(0);
    for (const element of Array.from(doc.querySelectorAll("*"))) {
      expect(element.hasAttribute("onerror")).toBe(false);
      expect(element.hasAttribute("onload")).toBe(false);
    }
    // The payload is visible as text, proving it was escaped and not parsed.
    expect(doc.querySelector("h1")?.textContent).toBe(XSS_TAG);
    expect(doc.body.textContent).toContain(XSS_ATTR);
  });

  it("keeps a hostile evidence URL inside the href attribute", () => {
    const hostile = buildDossier();
    hostile.evidence[0].url = `https://a.example/"><b>`;
    const doc = parse(render(hostile));
    expect(doc.querySelectorAll("li b")).toHaveLength(0);
    const link = doc.querySelector("li a[href]");
    expect(link?.getAttribute("href")).toBe(`https://a.example/"><b>`);
    expect(render(hostile)).toContain(
      'href="https://a.example/&quot;&gt;&lt;b&gt;"',
    );
  });

  // Defect probe: the schema forbids non-https URLs, but the renderer trusts its input.
  // Expected to fail today (src/lib/format/dossier-export.ts, evidence <a href="${e(item.url)}">),
  // so it is marked `fails`. Remove `.fails` when the renderer drops non-https hrefs.
  it("never outputs a javascript: URL as an href (defense in depth)", () => {
    const hostile = buildDossier();
    hostile.evidence[0].url = "javascript:alert(1)";
    const doc = parse(render(hostile));
    const hrefs = Array.from(doc.querySelectorAll("a[href]")).map((a) =>
      (a.getAttribute("href") ?? "").trim().toLowerCase(),
    );
    expect(hrefs.some((href) => href.startsWith("javascript:"))).toBe(false);
  });
});
