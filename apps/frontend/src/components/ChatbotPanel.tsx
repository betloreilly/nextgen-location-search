"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage, ChatResponsePayload, SearchResultHit, QueryPlan, UserContext, ExplanationBlock } from "@nextgen-location-search/types";

interface ChatbotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  results?: SearchResultHit[];
  queryPlan?: QueryPlan;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
function imageSrc(url: string | undefined): string {
  if (!url) return "";
  if (url.startsWith("/data/")) return `${API_URL.replace(/\/$/, "")}${url}`;
  return url;
}

interface ChatbotPanelProps {
  userContext: UserContext;
  onResultsUpdate: (
    results: SearchResultHit[],
    plan: QueryPlan,
    opensearchRequest?: { index: string; body: Record<string, unknown> } | null,
    explanation?: ExplanationBlock | null
  ) => void;
  /** Left-panel KEYWORD so keyword search matches the UI filters. */
  currentKeyword?: string;
}

export function ChatbotPanel({ userContext, onResultsUpdate, currentKeyword }: ChatbotPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatbotMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm your local search assistant. Tell me what you're looking for — I'll remember our conversation and refine results as we chat.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  const apiMessages: ChatMessage[] = messages
    .filter((m) => m.id !== "welcome")
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: new Date().toISOString(),
    }));

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: ChatbotMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setLoading(true);

    const outgoingApiMessages: ChatMessage[] = updatedMessages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date().toISOString(),
      }));

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "advanced",
          messages: outgoingApiMessages,
          userContext,
          // Don't send left-panel keyword in Advanced so the LLM intent (e.g. "lively") drives the search; the response plan then updates the panel.
          currentKeyword: undefined,
        }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data: ChatResponsePayload = await res.json() as ChatResponsePayload;

      const assistantContent =
        data.chatResponse ||
        (data.results.length > 0
          ? `Found ${data.results.length} result${data.results.length !== 1 ? "s" : ""}. ${data.results[0]?.name} looks great!`
          : "I couldn't find anything matching that. Try rephrasing your search.");

      const assistantMsg: ChatbotMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: assistantContent,
        // Don't attach result cards for conversational (non-search) replies
        results: data.isConversational ? undefined : data.results,
        queryPlan: data.isConversational ? undefined : data.queryPlan,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Only update the main results panel when a real search was run
      if (!data.isConversational) {
        onResultsUpdate(
          data.results,
          data.queryPlan,
          data.opensearchRequest ?? null,
          data.explanation ?? null
        );
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Sorry, something went wrong. ${err instanceof Error ? err.message : "Please try again."}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "fixed",
            bottom: "1.5rem",
            right: "1.5rem",
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#7c3aed",
            color: "#fff",
            border: "none",
            fontSize: "1.4rem",
            cursor: "pointer",
            boxShadow: "0 4px 20px rgba(124,58,237,0.4)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.15s",
          }}
          title="Open AI chat assistant"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: "1.5rem",
            right: "1.5rem",
            width: 360,
            maxWidth: "calc(100vw - 2rem)",
            height: 520,
            maxHeight: "calc(100vh - 4rem)",
            background: "var(--surface, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 16,
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.9rem 1rem 0.8rem",
              borderBottom: "1px solid var(--border, #e5e7eb)",
              background: "#7c3aed",
              color: "#fff",
              borderRadius: "16px 16px 0 0",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>AI Search Assistant</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{
                fontSize: "0.68rem",
                background: "rgba(255,255,255,0.2)",
                padding: "0.15rem 0.5rem",
                borderRadius: 100,
                fontWeight: 500,
              }}>
                memory on
              </span>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, padding: "0.1rem" }}
                title="Close"
              >
                ×
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "0.55rem 0.8rem",
                    borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    background: msg.role === "user" ? "#7c3aed" : "var(--surface-alt, #f3f4f6)",
                    color: msg.role === "user" ? "#fff" : "var(--text, #111)",
                    fontSize: "0.84rem",
                    lineHeight: 1.5,
                  }}
                >
                  {msg.content}
                </div>
                {msg.results && msg.results.length > 0 && (
                  <div style={{ marginTop: "0.35rem", display: "flex", flexDirection: "column", gap: "0.25rem", width: "100%" }}>
                    {msg.results.slice(0, 6).map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          background: "var(--surface-alt, #f9fafb)",
                          borderRadius: 8,
                          padding: "0.35rem 0.6rem",
                          fontSize: "0.78rem",
                          border: "1px solid var(--border, #e5e7eb)",
                        }}
                      >
                        {r.imageUrl && (
                          <img
                            src={imageSrc(r.imageUrl)}
                            alt={r.name}
                            style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                          <div style={{ opacity: 0.6 }}>
                            {r.rating} stars
                            {r.distanceKm != null ? ` · ${r.distanceKm.toFixed(1)} km` : ""}
                            {r.openNow !== undefined ? (r.openNow ? " · open" : " · closed") : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                <div style={{
                  background: "var(--surface-alt, #f3f4f6)",
                  borderRadius: "12px 12px 12px 2px",
                  padding: "0.55rem 0.8rem",
                  fontSize: "0.84rem",
                  color: "var(--text-muted, #6b7280)",
                }}>
                  Thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: "0.65rem 0.75rem",
              borderTop: "1px solid var(--border, #e5e7eb)",
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-end",
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything… e.g. quieter and cheaper option?"
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                border: "1px solid var(--border, #d1d5db)",
                borderRadius: 8,
                padding: "0.5rem 0.7rem",
                fontSize: "0.84rem",
                lineHeight: 1.4,
                fontFamily: "inherit",
                outline: "none",
                background: "var(--bg, #fff)",
                color: "var(--text, #111)",
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={loading || !input.trim()}
              style={{
                padding: "0.5rem 0.9rem",
                background: "#7c3aed",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: "0.84rem",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                opacity: loading || !input.trim() ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
