import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  csvCell,
  csvRow,
  neutralizeFormula,
  number,
  parseCsv,
  text,
  toCsv,
  type CsvCell,
} from "@/lib/format/csv";

/**
 * Tests for the spreadsheet-safe CSV writer (formula injection, quoting, round trip).
 * Property tests use the fixed seed 20260514 so every run explores the same cases.
 */
const SEED = 20260514;
const RUNS = 500;

// Independent statement of the rule, written from the spec, not copied from the source.
const TRIGGER_CHARS = "=+-@\t\r\n＝＋－＠";
const startsWithTrigger = (value: string) => {
  // Skip spaces, NBSP, BOM and other blanks, but not tab/CR/LF: those are triggers.
  const first = value.replace(/^[^\S\t\r\n]+/, "")[0];
  return first !== undefined && TRIGGER_CHARS.includes(first);
};

describe("neutralizeFormula", () => {
  const triggers: [string, string][] = [
    ["equals", "=1+1"],
    ["plus", "+1"],
    ["minus", "-1"],
    ["at", "@SUM(A1)"],
    ["tab", "\tvalue"],
    ["carriage return", "\rvalue"],
    ["line feed", "\nvalue"],
    ["leading spaces then equals", "   =1+1"],
    ["leading NBSP then plus", "\u00a0+cmd"],
    ["leading BOM then at", "\ufeff@x"],
    ["mixed whitespace then minus", " \u00a0 -2"],
    ["full-width equals", "＝1"],
    ["full-width plus", "＋1"],
    ["full-width minus", "－1"],
    ["full-width at", "＠x"],
    ["spaces then full-width equals", "  ＝1"],
    ["hyperlink payload", '=HYPERLINK("http://x","click")'],
    ["dde payload", "+cmd|' /C calc'!A0"],
  ];

  it.each(triggers)("prepends a single quote: %s", (_name, input) => {
    expect(neutralizeFormula(input)).toBe(`'${input}`);
  });

  const harmless = [
    "",
    "plain text",
    "Sombra y mercado",
    "1+1",
    "a=b",
    "email@example.com",
    "x-y",
    " leading space",
    "ñandú 🌳",
    "'=already quoted",
  ];

  it.each(harmless)("leaves harmless text untouched: %j", (input) => {
    expect(neutralizeFormula(input)).toBe(input);
  });

  it("returns the empty string unchanged", () => {
    expect(neutralizeFormula("")).toBe("");
  });

  it("a neutralized cell starts with a quote, so it no longer triggers", () => {
    for (const [, input] of triggers) {
      const out = neutralizeFormula(input);
      expect(out.startsWith("'")).toBe(true);
      expect(neutralizeFormula(out)).toBe(out);
      expect(out.slice(1)).toBe(input);
    }
  });
});

describe("csvCell", () => {
  it("always quotes text and doubles inner quotes", () => {
    expect(csvCell(text("hola"))).toBe('"hola"');
    expect(csvCell(text('di "hola"'))).toBe('"di ""hola"""');
    expect(csvCell(text(""))).toBe('""');
    expect(csvCell(text(null))).toBe('""');
    expect(csvCell(text(undefined))).toBe('""');
  });

  it("quotes commas, newlines, CRLF, unicode and emoji safely", () => {
    expect(csvCell(text("a,b"))).toBe('"a,b"');
    expect(csvCell(text("a\nb"))).toBe('"a\nb"');
    expect(csvCell(text("a\r\nb"))).toBe('"a\r\nb"');
    expect(csvCell(text("canción ñ 日本 🌳"))).toBe('"canción ñ 日本 🌳"');
  });

  it("neutralizes before quoting", () => {
    expect(csvCell(text("=1+1"))).toBe(`"'=1+1"`);
    expect(csvCell(text('"=x"'))).toBe('"""=x"""');
  });

  it("writes numbers plain, including negatives and decimals", () => {
    expect(csvCell(number(0))).toBe("0");
    expect(csvCell(number(42))).toBe("42");
    expect(csvCell(number(-5))).toBe("-5");
    expect(csvCell(number(-1234.5))).toBe("-1234.5");
    expect(csvCell(number(3.14159, 2))).toBe("3.14");
    expect(csvCell(number(-0.5, 2))).toBe("-0.50");
    expect(csvCell(number(7, 2))).toBe("7.00");
  });

  it("writes null, undefined, NaN and infinities as empty", () => {
    expect(csvCell(number(null))).toBe("");
    expect(csvCell(number(undefined))).toBe("");
    expect(csvCell(number(Number.NaN))).toBe("");
    expect(csvCell(number(Number.POSITIVE_INFINITY, 2))).toBe("");
    expect(csvCell(number(Number.NEGATIVE_INFINITY))).toBe("");
  });

  it("never neutralizes a numeric cell", () => {
    expect(csvCell(number(-9))).not.toContain("'");
  });
});

describe("csvRow and toCsv", () => {
  it("ends a row with CRLF and separates cells with commas", () => {
    expect(csvRow([text("a"), number(1), number(null)])).toBe('"a",1,\r\n');
  });

  it("starts the document with a BOM as its first character", () => {
    const csv = toCsv(["a"], [[text("x")]]);
    expect(csv[0]).toBe(CSV_BOM);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.indexOf(CSV_BOM, 1)).toBe(-1);
  });

  it("writes the header as quoted text, then the rows, with CRLF only", () => {
    const csv = toCsv(
      ["name", "qty"],
      [
        [text("uno"), number(1.5, 2)],
        [text("dos"), number(null)],
      ],
    );
    expect(csv).toBe(`${CSV_BOM}"name","qty"\r\n"uno",1.50\r\n"dos",\r\n`);
    expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("writes only a header when there are no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe(`${CSV_BOM}"a","b"\r\n`);
  });
});

describe("parseCsv", () => {
  it("round-trips a document with nasty cells", () => {
    const rows: CsvCell[][] = [
      [text("a,b"), text('q"uote'), text("line1\nline2"), number(-3.25)],
      [text("crlf\r\ninside"), text("canción 🌳"), text(""), number(null)],
    ];
    const parsed = parseCsv(toCsv(["h1", "h2", "h3", "h4"], rows));
    expect(parsed).toEqual([
      ["h1", "h2", "h3", "h4"],
      ["a,b", 'q"uote', "line1\nline2", "-3.25"],
      ["crlf\r\ninside", "canción 🌳", "", ""],
    ]);
  });

  it("strips the BOM and returns nothing for an empty input", () => {
    expect(parseCsv(CSV_BOM)).toEqual([]);
    expect(parseCsv("")).toEqual([]);
  });

  it("returns neutralized text with the leading quote", () => {
    const parsed = parseCsv(toCsv(["c"], [[text("=1+1")], [text("＝1")]]));
    expect(parsed.slice(1)).toEqual([["'=1+1"], ["'＝1"]]);
  });
});

describe("toCsv → parseCsv properties (seed 20260514)", () => {
  const nastyPrefix = fc.constantFrom(
    "=",
    "+",
    "-",
    "@",
    "\t",
    "\r",
    "\n",
    " =",
    "  +",
    "\u00a0@",
    "\ufeff-",
    " \u00a0\t=",
    "＝",
    "＋",
    "－",
    "＠",
    "  ＝",
    "'=",
    "",
  );
  const randomText = fc.oneof(
    fc.string({ unit: "binary", maxLength: 30 }),
    fc.string({ unit: "grapheme", maxLength: 30 }),
    fc.string({ maxLength: 30 }),
    fc.tuple(nastyPrefix, fc.string({ unit: "binary", maxLength: 20 })).map(
      ([prefix, rest]) => prefix + rest,
    ),
    fc.constantFrom('"', ',', '""', 'a,"b"\r\nc', "\r\n", "\n", "\r"),
  );

  const cellArb = fc.oneof(
    randomText.map((value) => ({ kind: "text" as const, value })),
    fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .map((value) => ({ kind: "number" as const, value })),
    fc.constant({ kind: "null" as const }),
  );

  const matrixArb = fc
    .tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 6 }))
    .chain(([cols, rowCount]) =>
      fc.array(fc.array(cellArb, { minLength: cols, maxLength: cols }), {
        minLength: rowCount,
        maxLength: rowCount,
      }).map((matrix) => ({ cols, matrix })),
    );

  type Spec = typeof cellArb extends fc.Arbitrary<infer T> ? T : never;
  const toCell = (cell: Spec): CsvCell =>
    cell.kind === "text"
      ? text(cell.value)
      : cell.kind === "number"
        ? number(cell.value)
        : number(null);

  it("recovers every cell, never leaves a trigger, and keeps the shape", () => {
    fc.assert(
      fc.property(matrixArb, ({ cols, matrix }) => {
        const header = Array.from({ length: cols }, (_, i) => `h${i}`);
        const parsed = parseCsv(toCsv(header, matrix.map((r) => r.map(toCell))));

        expect(parsed.length).toBe(matrix.length + 1);
        for (const row of parsed) expect(row.length).toBe(cols);
        expect(parsed[0]).toEqual(header);

        matrix.forEach((row, r) => {
          row.forEach((cell, c) => {
            const got = parsed[r + 1][c];
            if (cell.kind === "text") {
              const expected = startsWithTrigger(cell.value)
                ? `'${cell.value}`
                : cell.value;
              expect(got).toBe(expected);
              // Safety: no text cell triggers unless it begins with the single quote.
              if (!got.startsWith("'")) {
                expect(startsWithTrigger(got)).toBe(false);
              }
            } else if (cell.kind === "number") {
              expect(got).not.toBe("");
              expect(Number(got) === cell.value).toBe(true);
            } else {
              expect(got).toBe("");
            }
          });
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("neutralizeFormula only ever adds one leading quote", () => {
    fc.assert(
      fc.property(randomText, (value) => {
        const out = neutralizeFormula(value);
        expect(out === value || out === `'${value}`).toBe(true);
        expect(out === value).toBe(!startsWithTrigger(value));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("a text cell is always wrapped in double quotes", () => {
    fc.assert(
      fc.property(randomText, (value) => {
        const cell = csvCell(text(value));
        expect(cell.startsWith('"') && cell.endsWith('"')).toBe(true);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
