"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Team, MessageContentBlock, Plan } from "@/lib/agents/types";
import type { PendingAttachment } from "@/components/chat/fileAttachments";
import { extractText } from "@/components/chat/utils";

export interface ChatMessage {
  /** What actually gets sent to the API / resent as history. */
  role: "user" | "assistant";
  content: string | MessageContentBlock[];
  agentId?: string;
  /** The concrete model that actually answered this message (may differ from the agent's configured combo). */
  resolvedModel?: string;
  /** Display-only file chips — not part of `content` for text attachments (those are inlined into the text). */
  attachmentLabels?: string[];
  /** Set when this reply was classified as a finished deliverable and auto-saved to Outputs —
   *  the chat bubble should show a short confirmation instead of the full text. */
  outputSaved?: { outputId: string; format: string };
}

export interface RoutingInfo {
  from: string;
  to: string;
  reason: string;
}

/** One autonomous specialist-to-specialist handoff within a turn (distinct from the initial
 *  lead → specialist RoutingInfo) — a turn can have zero or more of these in sequence. */
export interface HandoffHop {
  from: string;
  to: string;
  reason: string;
}

interface UseAgentChatOptions {
  /** Active brand — threaded to the chat API so business profile/memory log are brand-scoped. */
  brandId: string;
  /** Chat directly with this agent, bypassing lead routing. */
  agentId?: string;
  /** Route through this team's lead — required when agentId is not set. */
  team?: Team;
}

function hasContent(content: string | MessageContentBlock[]): boolean {
  return content.length > 0;
}

interface PersistedChatState {
  messages: ChatMessage[];
  routing: RoutingInfo | null;
  activeAgentId?: string;
  handoffChain?: HandoffHop[];
}

/** sessionStorage key for a given chat "thread" — stable across page navigations within the
 *  same tab, so switching between pages and back doesn't lose the conversation. Cleared when
 *  the tab closes (sessionStorage), never synced across devices/tabs on purpose. */
function storageKey(brandId: string, agentId?: string, team?: Team): string {
  return `hastok:chat:${brandId}:${agentId ?? team ?? "unknown"}`;
}

function loadPersisted(key: string): PersistedChatState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PersistedChatState) : null;
  } catch {
    return null;
  }
}

function buildOutgoingContent(
  text: string,
  attachments: PendingAttachment[]
): string | MessageContentBlock[] {
  let finalText = text.trim();
  for (const att of attachments) {
    if (att.kind === "text") {
      finalText += `\n\n---\nקובץ מצורף: ${att.filename}\n\`\`\`\n${att.textContent}\n\`\`\``;
    }
  }
  if (!finalText) finalText = "(ראו קובץ מצורף)";

  const blocks = attachments.map((a) => a.block).filter((b): b is MessageContentBlock => !!b);
  if (blocks.length === 0) return finalText;
  return [...blocks, { type: "text", text: finalText }];
}

export function useAgentChat({ brandId, agentId, team }: UseAgentChatOptions) {
  // Computed once per hook instance (agentId/team/brandId don't change without remounting the
  // page that owns this hook), so it's safe to read as a plain value rather than memoizing.
  const [key] = useState(() => storageKey(brandId, agentId, team));

  // Starts empty (matching what SSR renders — sessionStorage doesn't exist on the server) and
  // hydrates from sessionStorage in an effect after mount. Reading sessionStorage directly in
  // the useState initializer would make the client's first render diverge from the server-
  // rendered HTML whenever a persisted conversation actually exists, causing a hydration error.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(agentId);
  const [routing, setRouting] = useState<RoutingInfo | null>(null);
  const [handoffChain, setHandoffChain] = useState<HandoffHop[]>([]);
  // A lead proposed a multi-agent plan that's awaiting approval — not persisted across page
  // reloads on purpose (re-approving a stale plan against a since-changed conversation would
  // be confusing); the user re-sends the request if they navigate away before approving.
  const [plan, setPlan] = useState<Plan | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // User-picked model override for this browser session only — never persisted, and
  // reset whenever this hook instance is recreated (e.g. switching agent/team/brand).
  const [modelOverride, setModelOverride] = useState<string | null>(null);

  useEffect(() => {
    const persisted = loadPersisted(key);
    if (persisted?.messages?.length) {
      setMessages(persisted.messages);
      setActiveAgentId(persisted.activeAgentId ?? agentId);
      setRouting(persisted.routing ?? null);
      setHandoffChain(persisted.handoffChain ?? []);
    }
    // Only ever run once per hook instance (on mount) — key/agentId are stable per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the conversation to sessionStorage on every change so navigating to another page
  // and back (or a same-tab reload) restores it instead of resetting to empty. Skips its very
  // first run — on mount, `messages` is still the pre-hydration empty array in this effect's
  // closure (the hydration effect's setMessages hasn't committed yet), so persisting then would
  // briefly wipe sessionStorage right as the hydration effect is about to repopulate it.
  const keyRef = useRef(key);
  keyRef.current = key;
  const skipNextPersistRef = useRef(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    if (messages.length === 0) {
      window.sessionStorage.removeItem(keyRef.current);
      return;
    }
    const state: PersistedChatState = { messages, routing, activeAgentId, handoffChain };
    try {
      window.sessionStorage.setItem(keyRef.current, JSON.stringify(state));
    } catch {
      // sessionStorage full/unavailable — conversation just won't survive navigation this time.
    }
  }, [messages, routing, activeAgentId, handoffChain]);

  const dropTrailingEmptyAssistant = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && !hasContent(last.content)) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  /** Reads an SSE response body and applies every event to chat state — shared by a normal
   *  chat turn (POST /api/chat) and an approved-plan execution (POST /api/plans/[id]/approve),
   *  which stream identically once the request is underway. `initialAgentId` seeds which
   *  agent's bubble token events append to before the first routing/handoff event (if any)
   *  narrows it further. */
  const consumeStream = useCallback(
    async (res: Response, initialAgentId?: string) => {
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: "שגיאה לא ידועה" }));
        throw new Error(data.error || "שגיאה בעיבוד הבקשה");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let resolvedAgentId = initialAgentId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const event = JSON.parse(part.slice(6));

          if (event.type === "routing") {
            resolvedAgentId = event.to;
            setActiveAgentId(event.to);
            setRouting({ from: event.from, to: event.to, reason: event.reason });
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { ...copy[copy.length - 1], agentId: event.to };
              return copy;
            });
          } else if (event.type === "plan_proposed") {
            // No reply text follows a plan proposal in this stream — drop the placeholder
            // bubble that was optimistically appended before the fetch, and surface the plan
            // for approval instead.
            dropTrailingEmptyAssistant();
            setPlan(event.plan);
          } else if (event.type === "plan_task_update") {
            setPlan((prev) =>
              prev && prev.id === event.planId
                ? {
                    ...prev,
                    tasks: prev.tasks.map((t) => (t.id === event.taskId ? { ...t, status: event.status } : t)),
                  }
                : prev
            );
          } else if (event.type === "token") {
            assistantText += event.text;
            const finalAgentId = resolvedAgentId;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                content: assistantText,
                agentId: finalAgentId,
              };
              return copy;
            });
          } else if (event.type === "handoff") {
            // A specialist autonomously handed off to another — start a fresh bubble for the
            // next specialist's reply, which streams in via further token events.
            resolvedAgentId = event.to;
            assistantText = "";
            setActiveAgentId(event.to);
            setHandoffChain((prev) => [...prev, { from: event.from, to: event.to, reason: event.reason }]);
            setMessages((prev) => [...prev, { role: "assistant", content: "", agentId: event.to }]);
          } else if (event.type === "output_saved") {
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                outputSaved: { outputId: event.outputId, format: event.format },
              };
              return copy;
            });
          } else if (event.type === "done") {
            if (event.resolvedModel) {
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { ...copy[copy.length - 1], resolvedModel: event.resolvedModel };
                return copy;
              });
            }
          } else if (event.type === "error") {
            setError(event.message);
            dropTrailingEmptyAssistant();
          }
        }
      }
    },
    [dropTrailingEmptyAssistant]
  );

  const sendMessage = useCallback(
    async (text: string, attachments: PendingAttachment[] = []) => {
      if ((!text.trim() && attachments.length === 0) || isStreaming) return;
      setError(null);
      setRouting(null);
      setHandoffChain([]);
      setPlan(null);

      // Drop any earlier turn left with empty content (e.g. an assistant reply that
      // errored out before any text arrived) — the API rejects empty message content,
      // and without this a single failed turn would permanently break the conversation.
      const history = messages.filter((m) => hasContent(m.content)).map((m) => ({ role: m.role, content: m.content }));
      const outgoingContent = buildOutgoingContent(text, attachments);
      const attachmentLabels = attachments.length > 0 ? attachments.map((a) => a.filename) : undefined;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: outgoingContent, attachmentLabels },
        { role: "assistant", content: "", agentId: activeAgentId },
      ]);
      setIsStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            // In a team workspace always address the team, never the agent that happened to speak
            // last. Sending `activeAgentId` (which any routing/handoff event set, and which
            // sessionStorage kept across navigations) pinned every later message to that one
            // specialist — the lead never planned again, and the server's resume path, which sits
            // behind the same `!agentId` branch, became permanently unreachable. A direct agent
            // chat still targets its own fixed agent, because that one the user really did pick.
            agentId: team ? undefined : agentId,
            team: team ?? undefined,
            message: outgoingContent,
            history,
            model: modelOverride ?? undefined,
          }),
        });
        await consumeStream(res, team ? undefined : agentId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        dropTrailingEmptyAssistant();
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, agentId, activeAgentId, team, brandId, isStreaming, modelOverride, consumeStream, dropTrailingEmptyAssistant]
  );

  const approvePlan = useCallback(async () => {
    if (!plan || isStreaming) return;
    setError(null);
    setIsStreaming(true);

    const firstAgentId = plan.tasks.find((t) => t.status === "ready" || t.status === "pending")?.agentId;
    const history = messages
      .filter((m) => hasContent(m.content))
      .map((m) => ({ role: m.role, content: extractText(m.content) }));

    setMessages((prev) => [...prev, { role: "assistant", content: "", agentId: firstAgentId }]);

    try {
      const res = await fetch(`/api/plans/${plan.id}/approve?brandId=${encodeURIComponent(brandId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      await consumeStream(res, firstAgentId);
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      dropTrailingEmptyAssistant();
    } finally {
      setIsStreaming(false);
    }
  }, [plan, messages, brandId, isStreaming, consumeStream, dropTrailingEmptyAssistant]);

  const cancelPlan = useCallback(async () => {
    if (!plan) return;
    const planId = plan.id;
    setPlan(null);
    try {
      await fetch(`/api/plans/${planId}/cancel?brandId=${encodeURIComponent(brandId)}`, { method: "POST" });
    } catch {
      // Best-effort — the plan is already cleared from view either way.
    }
  }, [plan, brandId]);

  /** Clears the conversation back to a blank slate — same effect as if sessionStorage never had
   *  anything for this thread. Doesn't touch the model override (a per-session preference the
   *  user likely wants to keep across a fresh start) or cancel an in-flight stream. */
  const resetConversation = useCallback(() => {
    setMessages([]);
    setRouting(null);
    setHandoffChain([]);
    setActiveAgentId(agentId);
    setPlan(null);
    setError(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(keyRef.current);
    }
  }, [agentId]);

  return {
    messages,
    sendMessage,
    isStreaming,
    error,
    routing,
    handoffChain,
    activeAgentId,
    modelOverride,
    setModelOverride,
    plan,
    approvePlan,
    cancelPlan,
    resetConversation,
  };
}
