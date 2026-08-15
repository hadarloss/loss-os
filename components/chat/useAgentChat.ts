"use client";

import { useCallback, useState } from "react";
import type { Team, MessageContentBlock } from "@/lib/agents/types";
import type { PendingAttachment } from "@/components/chat/fileAttachments";

export interface ChatMessage {
  /** What actually gets sent to the API / resent as history. */
  role: "user" | "assistant";
  content: string | MessageContentBlock[];
  agentId?: string;
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(agentId);
  const [routing, setRouting] = useState<RoutingInfo | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    [messages, activeAgentId, team, brandId, isStreaming, dropTrailingEmptyAssistant]
  );

  return { messages, sendMessage, isStreaming, error, routing, activeAgentId };
}
