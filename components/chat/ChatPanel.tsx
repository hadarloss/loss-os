"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RoutingBreadcrumb, type AgentLite } from "@/components/chat/RoutingBreadcrumb";
import type { ChatMessage, RoutingInfo, HandoffHop } from "@/components/chat/useAgentChat";
import { extractText } from "@/components/chat/utils";
import { processFile, type PendingAttachment } from "@/components/chat/fileAttachments";
import { useVoiceInput } from "@/components/chat/useVoiceInput";
import type { Team } from "@/lib/agents/types";
import type { ModelOption } from "@/lib/agents/modelOptions";
import { cn } from "@/lib/utils";

export interface SaveContext {
  brandId: string;
  team: Team;
  deliverableType?: string;
}

export interface ModelSelector {
  /** The model actually in effect right now — the override if set, else the active agent's default. */
  current: string;
  options: ModelOption[];
  onChange: (model: string) => void;
}

const ATTACHMENT_ACCEPT =
  ".txt,.md,.csv,.json,.yaml,.yml,.log,.tsv,.png,.jpg,.jpeg,.gif,.webp,.pdf,image/*,application/pdf";

const ATTACHMENT_ICON: Record<PendingAttachment["kind"], string> = {
  text: "📄",
  image: "🖼️",
  document: "📕",
};

export function ChatPanel({
  messages,
  onSend,
  isStreaming,
  error,
  routing,
  handoffChain = [],
  agentsById,
  placeholder = "כתבו הודעה...",
  emptyState,
  saveContext,
  modelSelector,
}: {
  messages: ChatMessage[];
  onSend: (text: string, attachments?: PendingAttachment[]) => void;
  isStreaming: boolean;
  error: string | null;
  routing: RoutingInfo | null;
  handoffChain?: HandoffHop[];
  agentsById: Record<string, AgentLite>;
  placeholder?: string;
  emptyState?: React.ReactNode;
  saveContext?: SaveContext;
  modelSelector?: ModelSelector;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [processingFiles, setProcessingFiles] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    isSupported: voiceSupported,
    isRecording,
    error: voiceError,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceInput({ onTranscriptChange: setDraft });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const handleSend = () => {
    if (!draft.trim() && attachments.length === 0) return;
    onSend(draft, attachments);
    setDraft("");
    setAttachments([]);
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setAttachError(null);
    setProcessingFiles(true);
    try {
      const processed = await Promise.all(Array.from(fileList).map(processFile));
      setAttachments((prev) => [...prev, ...processed]);
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : "שגיאה בקריאת הקובץ");
    } finally {
      setProcessingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {(routing || handoffChain.length > 0) && (
        <div className="p-3 pb-0">
          <RoutingBreadcrumb routing={routing} agentsById={agentsById} handoffChain={handoffChain} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.length === 0 && emptyState}
        {messages.map((message, i) => (
          <MessageBubble
            key={i}
            message={message}
            agent={message.agentId ? agentsById[message.agentId] : undefined}
            saveContext={saveContext}
            isLast={i === messages.length - 1}
            isStreaming={isStreaming}
          />
        ))}
        {error && (
          <div className="self-stretch rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3 pb-5 flex flex-col gap-2">
        {modelSelector && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">מודל בשיחה זו</span>
            <select
              value={modelSelector.current}
              onChange={(e) => modelSelector.onChange(e.target.value)}
              disabled={isStreaming}
              className="rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              title="בחירת מודל לשיחה הנוכחית בלבד — לא נשמר לפעם הבאה"
            >
              {modelSelector.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {(attachments.length > 0 || attachError || voiceError) && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
              >
                <span aria-hidden>{ATTACHMENT_ICON[att.kind]}</span>
                <span className="max-w-40 truncate">{att.filename}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`הסר ${att.filename}`}
                >
                  ✕
                </button>
              </span>
            ))}
            {attachError && <span className="text-xs text-destructive self-center">{attachError}</span>}
            {voiceError && <span className="text-xs text-destructive self-center">{voiceError}</span>}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="צירוף קובץ (טקסט, תמונה או PDF) — כך אפשר ללמד את הסוכן דברים בלי להקליד"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || processingFiles}
          >
            📎
          </Button>
          {voiceSupported && (
            <Button
              type="button"
              variant={isRecording ? "destructive" : "outline"}
              size="icon"
              title={isRecording ? "עצירת הקלטה" : "הקלטה קולית — דברו במקום להקליד"}
              onClick={() => (isRecording ? stopVoice() : startVoice(draft))}
              disabled={isStreaming}
              className={isRecording ? "animate-pulse" : undefined}
            >
              {isRecording ? "⏹️" : "🎤"}
            </Button>
          )}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={placeholder}
            disabled={isStreaming}
            className="min-h-11"
          />
          <Button onClick={handleSend} disabled={isStreaming || (!draft.trim() && attachments.length === 0)}>
            {isStreaming ? "כותב..." : "שליחה"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  agent,
  saveContext,
  isLast,
  isStreaming,
}: {
  message: ChatMessage;
  agent?: AgentLite;
  saveContext?: SaveContext;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memoryState, setMemoryState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAsXlsx, setSavedAsXlsx] = useState<{ outputPath: string } | null>(null);
  const isUser = message.role === "user";
  const text = extractText(message.content);
  const showSave =
    !isUser &&
    saveContext &&
    message.agentId &&
    text &&
    !(isLast && isStreaming) &&
    !savedAsXlsx &&
    !message.outputSaved;
  const showSaveMemory =
    !isUser && saveContext && text && !(isLast && isStreaming) && !message.outputSaved;

  const handleSave = async () => {
    if (!saveContext || !message.agentId) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/outputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: saveContext.brandId,
          team: saveContext.team,
          agentId: message.agentId,
          content: text,
          deliverableType: saveContext.deliverableType ?? "general",
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.handoff?.format === "xlsx" || data.format === "xlsx") {
        setSavedAsXlsx({ outputPath: data.path ?? data.handoff?.output_path ?? "" });
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const handleSaveMemory = async () => {
    if (!saveContext) return;
    setMemoryState("saving");
    try {
      const res = await fetch("/api/memory-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: saveContext.brandId,
          agent: message.agentId ?? "assistant",
          type: "note",
          summary: text,
        }),
      });
      if (!res.ok) throw new Error();
      setMemoryState("saved");
    } catch {
      setMemoryState("error");
    }
  };

  return (
    <div className={cn("flex flex-col max-w-[85%] gap-1", isUser ? "self-end items-end" : "self-start items-start")}>
      {!isUser && agent && (
        <div className="text-xs text-muted-foreground flex items-center gap-1 px-1">
          <span aria-hidden>{agent.icon}</span>
          <span>{agent.name}</span>
        </div>
      )}
      {message.attachmentLabels && message.attachmentLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-end">
          {message.attachmentLabels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-xs text-muted-foreground"
            >
              📎 {label}
            </span>
          ))}
        </div>
      )}
      <div
        className={cn(
          "rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {savedAsXlsx ? (
          <span>
            ✅ הגאנט נשמר כקובץ אקסל בתוצרים —{" "}
            <a
              href={`/${saveContext!.brandId}/outputs`}
              className="underline underline-offset-2 hover:text-primary"
            >
              מעבר לתוצרים
            </a>
          </span>
        ) : message.outputSaved ? (
          <span>
            ✅ התוצר נשמר בתוצרים לאישור —{" "}
            <a
              href={saveContext ? `/${saveContext.brandId}/outputs` : "#"}
              className="underline underline-offset-2 hover:text-primary"
            >
              מעבר לתוצרים
            </a>
          </span>
        ) : (
          text || (isLast && isStreaming ? "…" : "")
        )}
      </div>
      {!isUser && message.resolvedModel && (
        <span className="text-[10px] text-muted-foreground/70 px-1" title="המנוע שהשיב בפועל">
          {message.resolvedModel}
        </span>
      )}
      {(showSave || showSaveMemory) && (
        <div className="flex gap-3">
          {showSave && (
            <button
              onClick={handleSave}
              disabled={saveState === "saving" || saveState === "saved"}
              className="text-xs text-muted-foreground hover:text-foreground px-1 underline underline-offset-2 disabled:no-underline"
            >
              {saveState === "idle" && "💾 שמור כפלט"}
              {saveState === "saving" && "שומר..."}
              {saveState === "saved" && "✓ נשמר בתוצרים"}
              {saveState === "error" && "שגיאה בשמירה — נסה/י שוב"}
            </button>
          )}
          {showSaveMemory && (
            <button
              onClick={handleSaveMemory}
              disabled={memoryState === "saving" || memoryState === "saved"}
              className="text-xs text-muted-foreground hover:text-foreground px-1 underline underline-offset-2 disabled:no-underline"
            >
              {memoryState === "idle" && "💭 שמור כזיכרון"}
              {memoryState === "saving" && "שומר..."}
              {memoryState === "saved" && "✓ נשמר בזיכרון"}
              {memoryState === "error" && "שגיאה בשמירה — נסה/י שוב"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
