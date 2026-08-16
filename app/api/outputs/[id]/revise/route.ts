import { z } from "zod";
import { NextRequest } from "next/server";
import { getOutputForRevision, overwriteOutputContent } from "@/lib/fs/outputs";
import { getAgentById } from "@/lib/agents/registry";
import { streamAgentReply } from "@/lib/agents/router";
import { readBusinessProfile } from "@/lib/fs/businessProfile";
import { readMemoryLog } from "@/lib/fs/memoryLog";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { bumpOutputVersion, setOutputStatus, addOutputReview } from "@/lib/db/queries";

const ReviseSchema = z.object({
  note: z.string().min(1).max(100, "ההערה מוגבלת ל-100 תווים"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = ReviseSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "קלט לא תקין" }, { status: 400 });
  }

  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const output = await getOutputForRevision(brandId!, id);
  if (!output) {
    return Response.json(
      { error: "לא נמצא תוצר לעדכון (רק תוצרי טקסט נתמכים לבקשת שיפורים כרגע)" },
      { status: 404 }
    );
  }

  const agent = await getAgentById(output.agentId);
  if (!agent) {
    return Response.json({ error: "הסוכן שהכין את התוצר לא נמצא יותר" }, { status: 404 });
  }

  const [businessProfile, memoryLog] = await Promise.all([
    readBusinessProfile(brandId!),
    readMemoryLog(brandId!),
  ]);

  const revisionRequest = [
    "זהו עדכון לתוצר קיים שכבר הכנת, לא בקשה חדשה.",
    "",
    "## התוצר הקודם שלך",
    output.content,
    "",
    `## הערת שיפור מהמשתמש\n${parsed.data.note}`,
    "",
    "כתוב/כתבי גרסה מעודכנת מלאה של התוצר (לא רק את השינוי) שמשלבת את ההערה.",
  ].join("\n");

  let updatedContent = "";
  let streamError: Error | null = null;
  await new Promise<void>((resolve) => {
    streamAgentReply(
      agent,
      [{ role: "user", content: revisionRequest }],
      businessProfile,
      memoryLog,
      {
        onText: () => {},
        onDone: (text) => {
          updatedContent = text;
          resolve();
        },
        onError: (error) => {
          streamError = error;
          resolve();
        },
      }
    ).catch((error) => {
      streamError = error instanceof Error ? error : new Error(String(error));
      resolve();
    });
  });

  if (streamError || !updatedContent.trim()) {
    return Response.json(
      { error: (streamError as Error | null)?.message ?? "לא התקבלה תגובה מהסוכן" },
      { status: 502 }
    );
  }

  const ok = await overwriteOutputContent(brandId!, id, updatedContent);
  if (!ok) {
    return Response.json({ error: "עדכון התוצר נכשל" }, { status: 500 });
  }

  const version = bumpOutputVersion(id);
  setOutputStatus(id, "pending");
  addOutputReview({
    outputId: id,
    brandId: brandId!,
    authorUserId: guard.user.id,
    action: "changes_requested",
    note: parsed.data.note,
  });

  return Response.json({ content: updatedContent, version, status: "pending" });
}
