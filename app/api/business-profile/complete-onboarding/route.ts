import { z } from "zod";
import { NextRequest } from "next/server";
import { getAgentById } from "@/lib/agents/registry";
import { streamAgentReply, ConversationMessage } from "@/lib/agents/router";
import { readBusinessProfile, writeBusinessProfile, readBusinessProfileFull } from "@/lib/fs/businessProfile";
import { readMemoryLog } from "@/lib/fs/memoryLog";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { ONBOARDING_QUESTIONS } from "@/lib/agents/onboardingQuestions";

const AnswerSchema = z.object({ id: z.string(), question: z.string(), answer: z.string() });
const BodySchema = z.object({ answers: z.array(AnswerSchema) });

/**
 * The one and only point אורית (the onboarding agent) actually runs — the wizard UI collects
 * all 12 answers with no LLM involved per question, then this endpoint makes a single call to
 * synthesize them into the full business-file document. Replaces the old chat-turn-count gate:
 * the hard requirement now is simply "all 12 questions answered", enforced below before אורית
 * is ever called.
 */
export async function POST(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const answersById = new Map(parsed.data.answers.map((a) => [a.id, a.answer.trim()]));
  const missing = ONBOARDING_QUESTIONS.filter((q) => !(answersById.get(q.id) ?? "").length);
  if (missing.length > 0) {
    return Response.json(
      { error: `חסרות תשובות לשאלות: ${missing.map((q) => q.question).join("; ")}` },
      { status: 400 }
    );
  }

  const agent = await getAgentById("onboarding");
  if (!agent) {
    return Response.json({ error: "סוכן האונבורדינג לא נמצא" }, { status: 500 });
  }

  const [businessProfile, memoryLog] = await Promise.all([
    readBusinessProfile(brandId!),
    readMemoryLog(brandId!),
  ]);

  const qaText = ONBOARDING_QUESTIONS.map(
    (q, i) => `${i + 1}. ${q.question}\nתשובה: ${answersById.get(q.id)}`
  ).join("\n\n");

  const history: ConversationMessage[] = [
    {
      role: "user",
      content:
        "להלן 12 תשובות שנאספו משאלון היכרות עסקי מובנה (לא שיחה — כל תשובה נאספה בנפרד). " +
        "אין צורך לחזור על התשובות או לנסח אותן מחדש כאילו זו שיחה — תפקידך היחיד כרגע הוא " +
        "לייצר את מסמך `BUSINESS_PROFILE.md` המלא לפי המבנה הקבוע (ראו קובץ הבסיס), " +
        "ישירות מהתשובות האלה, בלי טקסט נוסף לפני/אחרי המסמך עצמו:\n\n" +
        qaText,
    },
  ];

  let fullText = "";
  let streamError: Error | null = null;
  await new Promise<void>((resolve) => {
    streamAgentReply(
      agent,
      history,
      businessProfile,
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
      { error: (streamError as Error | null)?.message || "אורית לא הצליחה להפיק תיק עסק — נסו שוב." },
      { status: 502 }
    );
  }

  await writeBusinessProfile(brandId!, fullText);
  const profile = await readBusinessProfileFull(brandId!);
  return Response.json({ content: profile.content, status: profile.status });
}
