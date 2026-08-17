import { z } from "zod";
import { NextRequest } from "next/server";
import { getAgentById } from "@/lib/agents/registry";
import { streamAgentReply, ConversationMessage } from "@/lib/agents/router";
import { readBusinessProfileFull, writeBusinessProfile } from "@/lib/fs/businessProfile";
import { readMemoryLog } from "@/lib/fs/memoryLog";
import { requireBrandMember } from "@/lib/auth/brandAccess";

// No length cap on the revision note by design — this is the "unlimited text box" round-of-
// improvements action on the business-file page, distinct from a full reject/reset.
const BodySchema = z.object({ note: z.string().min(1) });

export async function POST(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const profile = await readBusinessProfileFull(brandId!);
  if (profile.status !== "pending_approval") {
    return Response.json(
      { error: "אפשר לבקש שיפורים רק על תיק עסק שממתין לאישור." },
      { status: 400 }
    );
  }

  const agent = await getAgentById("onboarding");
  if (!agent) {
    return Response.json({ error: "סוכן האונבורדינג לא נמצא" }, { status: 500 });
  }

  const memoryLog = await readMemoryLog(brandId!);
  // The current draft is already in the system prompt's business-profile context block
  // (buildContextBlock, injected via businessProfile param below) — no need to repeat it here.
  const history: ConversationMessage[] = [
    {
      role: "user",
      content:
        "תיק העסק הנוכחי שלך מופיע למעלה כהקשר. המשתמש ביקש את השינויים הבאים לתיק — " +
        "עדכני את המסמך בהתאם ותחזירי את **המסמך המלא** מחדש (לא רק את החלק שהשתנה, לא הסבר " +
        "על השינוי — רק המסמך השלם המעודכן, לפי אותו מבנה קבוע):\n\n" + parsed.data.note.trim(),
    },
  ];

  let fullText = "";
  let streamError: Error | null = null;
  await new Promise<void>((resolve) => {
    streamAgentReply(
      agent,
      history,
      profile.content,
      memoryLog,
      {
        onText: (delta) => {
          fullText += delta;
        },
        onDone: (text) => {
          fullText = text;
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

  if (streamError || !fullText.trim()) {
    return Response.json(
      { error: (streamError as Error | null)?.message || "עדכון התיק נכשל — נסו שוב." },
      { status: 502 }
    );
  }

  await writeBusinessProfile(brandId!, fullText);
  const updated = await readBusinessProfileFull(brandId!);
  return Response.json({ content: updated.content, status: updated.status });
}
