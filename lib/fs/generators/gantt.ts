import ExcelJS from "exceljs";

export interface GanttTask {
  task: string;
  start: string;
  end: string;
  owner?: string;
}

const FENCED_JSON_RE = /```json\s*([\s\S]*?)```/i;

/**
 * Looks for a fenced ```json block containing an array of {task, start, end, owner}
 * objects inside a deliverable's markdown content. Returns null (rather than throwing)
 * when no such block exists or it doesn't parse — callers should fall back to a plain
 * markdown save in that case, never hard-fail the save.
 */
export function parseGanttFromContent(content: string): GanttTask[] | null {
  const match = content.match(FENCED_JSON_RE);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const tasks: GanttTask[] = [];
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.task !== "string" ||
        typeof item.start !== "string" ||
        typeof item.end !== "string"
      ) {
        return null;
      }
      tasks.push({
        task: item.task,
        start: item.start,
        end: item.end,
        owner: typeof item.owner === "string" ? item.owner : undefined,
      });
    }
    return tasks;
  } catch {
    return null;
  }
}

/** Builds an .xlsx workbook buffer for a Gantt-shaped task list, Hebrew RTL-friendly headers. */
export async function buildGanttWorkbook(tasks: GanttTask[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("גאנט", { views: [{ rightToLeft: true }] });

  sheet.columns = [
    { header: "משימה", key: "task", width: 40 },
    { header: "תאריך התחלה", key: "start", width: 16 },
    { header: "תאריך סיום", key: "end", width: 16 },
    { header: "אחראי/ערוץ", key: "owner", width: 20 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "right" };

  for (const t of tasks) {
    sheet.addRow({ task: t.task, start: t.start, end: t.end, owner: t.owner ?? "" });
  }

  sheet.eachRow((row) => {
    row.alignment = { horizontal: "right" };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
