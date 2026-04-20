"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

const QUICK_PROMPTS = [
  "What is the maximum security deposit in NY?",
  "Help me draft an annual lease in Tel Aviv",
  "What rights do tenants have in California?",
  "מה התנאים לסיום שכירות מוקדם?",
];

const RTL_REGEX = /[\u0590-\u05FF\u0600-\u06FF]/;

export default function ChatBox() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      const meta = `${data.usage.totalTokens} tokens · ${(data.usage.durationMs / 1000).toFixed(1)}s · $${Number(data.usage.costUsd).toFixed(6)}`;
      setMessages((m) => [...m, { role: "assistant", content: data.reply, meta }]);
    } catch (err) {
      setError((err as Error).message);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="chat-shell">
      {messages.length === 0 ? (
        <>
          <div className="chat-hero">
            <h1>How can I help with your contract?</h1>
            <p>Ask anything about rentals, jurisdictions, or lease terms.</p>
          </div>
        </>
      ) : (
        <div className="chat-thread">
          {messages.map((m, i) => {
            const dir = RTL_REGEX.test(m.content) ? "rtl" : "ltr";
            return (
              <div
                key={i}
                className={`chat-msg ${m.role}`}
                dir={dir}
              >
                {m.content}
                {m.meta && <span className="meta">{m.meta}</span>}
              </div>
            );
          })}
          {busy && (
            <div className="chat-msg assistant" style={{ opacity: 0.7 }}>
              <em>thinking…</em>
            </div>
          )}
          <div ref={threadRef} />
        </div>
      )}

      <div className="chat-input-wrap" style={{ marginTop: messages.length === 0 ? 0 : "1rem" }}>
        <textarea
          ref={taRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about contracts, jurisdictions, or lease terms…"
          rows={1}
          dir={RTL_REGEX.test(input) ? "rtl" : "ltr"}
          disabled={busy}
        />
        <button
          className="chat-send"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>

      {messages.length === 0 && (
        <div className="chat-quick">
          {QUICK_PROMPTS.map((q) => (
            <button key={q} onClick={() => void send(q)} disabled={busy}>
              {q}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="card" style={{ marginTop: "1rem", borderColor: "var(--err)", maxWidth: 720, width: "100%" }}>
          <strong style={{ color: "var(--err)" }}>Error:</strong> {error}
        </div>
      )}
    </div>
  );
}
