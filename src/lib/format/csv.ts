/**
 * CSV for spreadsheets (RFC 4180) with formula-injection neutralization (FT-15).
 *
 * A cell is either a user-controlled text cell or a numeric cell. Text cells are always
 * quoted, and when they start with a character a spreadsheet may read as a formula (after
 * trimming), a single quote is prepended, which spreadsheets show as plain text.
 * Numeric cells are a separate type that can never carry user text, so a legitimate
 * negative number stays a number.
 */

export type CsvCell =
  | { type: "text"; value: string }
  | { type: "number"; value: number | null; decimals?: number };

export const text = (value: string | null | undefined): CsvCell => ({
  type: "text",
  value: value ?? "",
});

export const number = (
  value: number | null | undefined,
  decimals?: number,
): CsvCell => ({
  type: "number",
  value: value ?? null,
  decimals,
});

// Characters that start a formula or a command in common spreadsheet programs, including
// the full-width forms and the leading whitespace some importers strip.
const FORMULA_START = /^[\s\u00a0\ufeff]*[=+\-@\t\r\n\uff1d\uff0b\uff0d\uff20]/;

/** Neutralizes a text cell. Pure and idempotent on already-neutral text. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function csvCell(cell: CsvCell): string {
  if (cell.type === "number") {
    if (cell.value === null || !Number.isFinite(cell.value)) return "";
    return cell.decimals === undefined
      ? String(cell.value)
      : cell.value.toFixed(cell.decimals);
  }
  return quote(neutralizeFormula(cell.value));
}

export const CSV_BOM = "\ufeff";

/** One CRLF-terminated record. */
export function csvRow(cells: readonly CsvCell[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

/** A whole document: BOM, header row of text cells, then data rows. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string {
  return (
    CSV_BOM +
    csvRow(header.map((name) => text(name))) +
    rows.map(csvRow).join("")
  );
}

/**
 * Minimal RFC 4180 reader used by tests to prove that neutralization survives a round
 * trip. It understands quoted cells, doubled quotes, commas, and CRLF.
 */
export function parseCsv(input: string): string[][] {
  const source = input.startsWith(CSV_BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && source[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
