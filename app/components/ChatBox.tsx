"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "./LocaleProvider";

interface Section {
  id: string;
  content_legal: string;
  content_bridge: string;
  content_ui: string;
}
interface ContractArtifact {
  type: "contract";
  contractId: string;
  document: {
    metadata: {
      jurisdiction: string;
      jurisdictionLanguage: string;
      bridgeLanguage: string;
      uiLanguage: string;
      type: string;
    };
    sections: Section[];
  };
  placeholders: string[];
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
  artifact?: ContractArtifact;
}

const RTL_REGEX = /[\u0590-\u05FF\u0600-\u06FF]/;

export default function ChatBox() {
  const t = useT();
  const { locale } = useLocale();
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
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
          uiLocale: locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      const meta = `${data.usage.totalTokens} tokens · ${(data.usage.durationMs / 1000).toFixed(1)}s · $${Number(data.usage.costUsd).toFixed(6)}`;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply,
          meta,
          artifact: data.artifact,
        },
      ]);
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
      {messages.length === 0 && (
        <div className="chat-hero">
          <h1>{t.home.title}</h1>
          <p>{t.home.subtitle}</p>
        </div>
      )}

      {messages.length > 0 && (
        <div className="chat-thread">
          {messages.map((m, i) => {
            const dir = RTL_REGEX.test(m.content) ? "rtl" : "ltr";
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div className={`chat-msg ${m.role}`} dir={dir}>
                  {m.content}
                  {m.meta && <span className="meta">{m.meta}</span>}
                </div>
                {m.artifact?.type === "contract" && (
                  <ContractCard art={m.artifact} />
                )}
              </div>
            );
          })}
          {busy && (
            <div className="chat-msg assistant" style={{ opacity: 0.7 }}>
              <em>{t.home.thinking}</em>
            </div>
          )}
          <div ref={threadRef} />
        </div>
      )}

      <div
        className="chat-input-wrap"
        style={{ marginTop: messages.length === 0 ? 0 : "1rem" }}
      >
        <textarea
          ref={taRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t.home.placeholder}
          rows={1}
          dir={RTL_REGEX.test(input) ? "rtl" : "ltr"}
          disabled={busy}
        />
        <button
          className="chat-send"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : t.home.send}
        </button>
      </div>

      {messages.length === 0 && (
        <div className="chat-quick">
          {t.home.quick.map((q) => (
            <button key={q} onClick={() => void send(q)} disabled={busy}>
              {q}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          className="card"
          style={{
            marginTop: "1rem",
            borderColor: "var(--err)",
            maxWidth: 720,
            width: "100%",
          }}
        >
          <strong style={{ color: "var(--err)" }}>{t.common.error}:</strong> {error}
        </div>
      )}
    </div>
  );
}

function ContractCard({ art }: { art: ContractArtifact }) {
  const meta = art.document.metadata;
  const isRtl = RTL_REGEX.test(art.document.sections[0]?.content_ui ?? "");
  const sectionsToShow = art.document.sections.slice(0, 3);
  const remaining = art.document.sections.length - sectionsToShow.length;

  return (
    <div
      className="card"
      style={{
        marginTop: "0.5rem",
        maxWidth: 720,
        width: "100%",
        borderColor: "var(--brand-green)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>
          {meta.type} · {meta.jurisdiction}
          <span className="muted mono" style={{ fontSize: "0.75rem", marginInlineStart: "0.5rem", fontWeight: 400 }}>
            {art.contractId.slice(0, 10)}…
          </span>
        </h3>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          {meta.jurisdictionLanguage} / {meta.bridgeLanguage} / {meta.uiLanguage}
        </span>
      </header>

      <div dir={isRtl ? "rtl" : "ltr"} style={{ marginTop: "0.75rem" }}>
        {sectionsToShow.map((s) => (
          <div key={s.id} style={{ marginBottom: "0.6rem" }}>
            <div className="mono muted" style={{ fontSize: "0.7rem" }}>{s.id}</div>
            <div className="section-content" style={{ fontSize: "0.85rem" }}>
              {s.content_ui.length > 320 ? s.content_ui.slice(0, 320) + "…" : s.content_ui}
            </div>
          </div>
        ))}
        {remaining > 0 && (
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            … +{remaining} more sections
          </p>
        )}
      </div>

      {art.placeholders.length > 0 && (
        <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "var(--surface-2)", borderRadius: 8 }}>
          <div className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.25rem" }}>
            {art.placeholders.length} placeholder{art.placeholders.length === 1 ? "" : "s"}
          </div>
          <div className="mono" style={{ fontSize: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {art.placeholders.slice(0, 12).map((p) => (
              <span key={p} style={{ background: "var(--surface)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>
                [[{p}]]
              </span>
            ))}
            {art.placeholders.length > 12 && <span>+{art.placeholders.length - 12}</span>}
          </div>
        </div>
      )}

      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Link href={`/history/${art.contractId}`} className="ghost" style={{ display: "inline-block", padding: "0.4rem 0.85rem", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", fontSize: "0.85rem" }}>
          Open full contract →
        </Link>
        {art.placeholders.length > 0 && (
          <Link href={`/history/${art.contractId}`} className="ghost" style={{ display: "inline-block", padding: "0.4rem 0.85rem", border: "1px solid var(--brand-green)", color: "var(--brand-green)", borderRadius: 8, textDecoration: "none", fontSize: "0.85rem" }}>
            Fill in details
          </Link>
        )}
      </div>
    </div>
  );
}
