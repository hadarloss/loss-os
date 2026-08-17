import ExcelJS from "exceljs";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

const FENCED_JSON_RE = /```json\s*([\s\S]*?)```/i;

/** Cell text cleanup: markdown emphasis and stray pipes contribute nothing to a spreadsheet. */
function cleanCell(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .trim();
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map(cleanCell);
}

/** A markdown separator row: |---|:--:|---| and friends. */
function isSeparatorRow(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

/**
 * The first markdown table in the content, as headers + rows.
 *
 * This is the path that actually matters in practice: agents write calendars and Gantts as
 * markdown tables, because that is what reads well in chat. The previous implementation only
 * accepted a hand-specified fenced ```json array, so a perfectly good schedule silently degraded
 * to a plain .md file whenever the model formatted it the natural way.
 */
function parseMarkdownTable(content: string): ParsedTable | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i];
    if (!header.includes("|")) continue;
    if (!isSeparatorRow(lines[i + 1])) continue;

    const headers = splitMarkdownRow(header).filter((h) => h.length > 0);
    if (headers.length < 2) continue;

    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const line = lines[j];
      if (!line.includes("|")) break;
      if (isSeparatorRow(line)) continue;
      const cells = splitMarkdownRow(line);
      // Skip spacer rows that carry no content at all (e.g. | | | | ).
      if (cells.every((c) => c.length === 0 || c === "—" || c === "-")) continue;
      rows.push(cells);
    }
    if (rows.length > 0) return { headers, rows };
  }
  return null;
}

/** A fenced ```json array of objects, as headers + rows. Keys become columns, union-ordered. */
function parseJsonTable(content: string): ParsedTable | null {
  const match = content.match(FENCED_JSON_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const headers: string[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      for (const key of Object.keys(item)) {
        if (!headers.includes(key)) headers.push(key);
      }
    }
    if (headers.length === 0) return null;

    const rows = parsed.map((item) =>
      headers.map((h) => {
        const v = (item as Record<string, unknown>)[h];
        return v === undefined || v === null ? "" : String(v);
      })
    );
    return { headers, rows };
  } catch {
    return null;
  }
}

/**
 * Tabular content inside a deliverable, if there is any — JSON block first (more precise), then
 * the first markdown table. Returns null rather than throwing so a save never hard-fails.
 */
export function parseTableFromContent(content: string): ParsedTable | null {
  return parseJsonTable(content) ?? parseMarkdownTable(content);
}

/**
 * Whether a table is substantial enough to hand over as a spreadsheet on its own, independent of
 * what the classifier happened to name the deliverable type. Guards against turning a two-row
 * comparison inside an article into a download.
 */
export function isSubstantialTable(table: ParsedTable): boolean {
  return table.headers.length >= 3 && table.rows.length >= 3;
}

/** Builds an .xlsx workbook from any parsed table, Hebrew RTL-friendly. */
export async function buildTableWorkbook(table: ParsedTable, sheetName = "גאנט"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // Excel rejects these characters in a sheet name and caps it at 31 chars.
  const safeName = sheetName.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "גיליון";
  const sheet = workbook.addWorksheet(safeName, { views: [{ rightToLeft: true }] });

  sheet.columns = table.headers.map((header) => ({
    header,
    key: header,
    // Wide enough for Hebrew content without being unwieldy; title columns are the long ones.
    width: Math.min(Math.max(header.length + 6, 16), 45),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "right" };

  for (const row of table.rows) {
    // Pad/trim so a ragged markdown row can't shift cells into the wrong columns.
    sheet.addRow(table.headers.map((_, i) => row[i] ?? ""));
  }

  sheet.eachRow((row) => {
    row.alignment = { horizontal: "right", wrapText: true };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
