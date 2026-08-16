import type { ImageMediaType, MessageContentBlock } from "@/lib/agents/types";

const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".log", ".tsv"];
const IMAGE_MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

export interface PendingAttachment {
  id: string;
  filename: string;
  kind: "text" | "image" | "document";
  textContent?: string;
  block?: MessageContentBlock;
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/") || file.type === "application/json") return true;
  const lower = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("קריאת הקובץ נכשלה"));
    reader.readAsText(file);
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("קריאת הקובץ נכשלה"));
    reader.readAsDataURL(file);
  });
}

/** Reads a File into a PendingAttachment: text files are embedded as text later, images/PDFs become content blocks. */
export async function processFile(file: File): Promise<PendingAttachment> {
  const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`הקובץ "${file.name}" גדול מדי (מקסימום 15MB).`);
  }

  if (isTextFile(file)) {
    const text = await readAsText(file);
    return { id, filename: file.name, kind: "text", textContent: text };
  }

  if (IMAGE_MEDIA_TYPES.includes(file.type as ImageMediaType)) {
    const data = await readAsBase64(file);
    return {
      id,
      filename: file.name,
      kind: "image",
      block: {
        type: "image",
        source: { type: "base64", media_type: file.type as ImageMediaType, data },
        filename: file.name,
      },
    };
  }

  if (file.type === "application/pdf") {
    const data = await readAsBase64(file);
    return {
      id,
      filename: file.name,
      kind: "document",
      block: {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
        title: file.name,
      },
    };
  }

  throw new Error(`סוג קובץ לא נתמך: "${file.name}". אפשר טקסט/md/csv/json, תמונות (jpg/png/gif/webp) או PDF.`);
}
