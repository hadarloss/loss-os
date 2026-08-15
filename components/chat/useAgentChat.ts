"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Team, MessageContentBlock } from "@/lib/agents/types";
import type { PendingAttachment } from "@/components/chat/fileAttachments";

export interface ChatMessage {
  /** What actually gets sent to the API / resent as history. */
  role: "user" | "assistant";
  content: string | MessageContentBlock[];
  agentId?: string;
  /** The concrete model that actually answered this message (may differ from the agent's configured combo). */
  resolvedModel?: string;
  /** Display-only file chips — not part of `content` for text attachments (those are inlined into the text). */
  attachmentLabels?: string[];
}

export interface RoutingInfo {
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

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadPersisted(key)?.messages ?? []);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(
    () => loadPersisted(key)?.activeAgentId ?? agentId
  );
  const [routing, setRouting] = useState<RoutingInfo | null>(() => loadPersisted(key)?.routing ?? null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // User-picked model override for this browser session only — never persisted, and
  // reset whenever this hook instance is recreated (e.g. switching agent/team/brand).
  const [modelOverride, setModelOverride] = useState<string | null>(null);

  // Persist the conversation to sessionStorage on every change so navigating to another page
  // and back (or a same-tab reload) restores it instead of resetting to empty.
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (messages.length === 0) {
      window.sessionStorage.removeItem(keyRef.current);
      return;
    }
    const state: PersistedChatState = { messages, routing, activeAgentId };
    try {
      window.sessionStorage.setItem(keyRef.current, JSON.stringify(state));
    } catch {
      // sessionStorage full/unavailable — conversation just won't survive navigation this time.
    }
  }, [messages, routing, activeAgentId]);

  const dropTrailingEmptyAssistant = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && !hasContent(last.content)) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string, attachments: PendingAttachment[] = []) => {
      if ((!text.trim() && attachments.length === 0) || isStreaming) return;
      setError(null);
      setRouting(null);

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

      let assistantText = "";
      let resolvedAgentId = activeAgentId;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId,
            agentId: activeAgentId,
            team: activeAgentId ? undefined : team,
            message: outgoingContent,
            history,
            model: modelOverride ?? undefined,
          }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({ error: "שגיאה לא ידועה" }));
          throw new Error(data.error || "שגיאה בשליחת ההודעה");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        dropTrailingEmptyAssistant();
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, activeAgentId, team, brandId, isStreaming, modelOverride, dropTrailingEmptyAssistant]
  );

  return {
    messages,
    sendMessage,
    isStreaming,
    error,
    routing,
    activeAgentId,
    modelOverride,
    setModelOverride,
  };
}
