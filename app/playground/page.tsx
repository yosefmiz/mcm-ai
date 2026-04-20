"use client";

import { useState } from "react";
import { useT } from "../components/LocaleProvider";

type Lang = "HE" | "EN" | "RU" | "AR";
type Ctype = "ANNUAL" | "SUBLET" | "MANAGEMENT";
const RTL: ReadonlySet<Lang> = new Set(["HE", "AR"]);

interface Section {
  id: string;
  title: string;
  content: string;
}
interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  costUsd: number;
  model: string;
}
interface GenResponse {
  id: string;
  document: {
    metadata: { jurisdiction: string; language: Lang; type: Ctype };
    sections: Section[];
  };
  usage: Usage;
}
interface EditResponse {
  id: string;
  section: Section;
  usage: Usage;
}

const DEFAULT_INPUTS = JSON.stringify(
  {
    landlord: "Alice Cohen",
    tenant: "Bob Levi",
    property_address: "123 Main St, Brooklyn NY",
    monthly_rent_usd: 2400,
    lease_start: "2026-05-01",
    lease_term_months: 12,
    deposit_usd: 4800,
  },
  null,
  2,
);

export default function Playground() {
  const t = useT();
  const [jurisdiction, setJurisdiction] = useState("NY, US");
  const [language, setLanguage] = useState<Lang>("EN");
  const [type, setType] = useState<Ctype>("ANNUAL");
  const [inputsText, setInputsText] = useState(DEFAULT_INPUTS);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contract, setContract] = useState<GenResponse | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let inputs: Record<string, unknown> = {};
      try {
        inputs = JSON.parse(inputsText);
      } catch {
        throw new Error("Inputs is not valid JSON");
      }
      const res = await fetch("/api/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jurisdiction, language, type, inputs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setContract(data as GenResponse);
      setUsage(data.usage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyEdit(sectionId: string) {
    if (!contract || !editInstruction.trim()) return;
    setEditBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contract", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: contract.id,
          sectionId,
          userInstruction: editInstruction,
        }),
      });
      const data: EditResponse | { error: string } = await res.json();
      if (!res.ok || !("section" in data)) {
        throw new Error("error" in data ? data.error : "Edit failed");
      }
      setContract({
        ...contract,
        document: {
          ...contract.document,
          sections: contract.document.sections.map((s) =>
            s.id === sectionId ? data.section : s,
          ),
        },
      });
      setUsage(data.usage);
      setEditingId(null);
      setEditInstruction("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEditBusy(false);
    }
  }

  const dir = RTL.has(language) ? "rtl" : "ltr";

  return (
    <main>
      <h1>{t.playground.title}</h1>
      <p className="muted">{t.playground.subtitle}</p>

      <form onSubmit={generate} className="card" style={{ marginTop: "1rem" }}>
        <div className="grid-3">
          <div>
            <label>{t.playground.jurisdiction}</label>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              placeholder="NY, US / IL / DE-BE"
              required
            />
          </div>
          <div>
            <label>{t.playground.language}</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
              <option value="EN">English</option>
              <option value="HE">עברית</option>
              <option value="RU">Русский</option>
              <option value="AR">العربية</option>
            </select>
          </div>
          <div>
            <label>{t.playground.type}</label>
            <select value={type} onChange={(e) => setType(e.target.value as Ctype)}>
              <option value="ANNUAL">{t.playground.typeAnnual}</option>
              <option value="SUBLET">{t.playground.typeSublet}</option>
              <option value="MANAGEMENT">{t.playground.typeManagement}</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <label>{t.playground.inputsJson}</label>
          <textarea value={inputsText} onChange={(e) => setInputsText(e.target.value)} />
        </div>
        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span className="muted" style={{ fontSize: "0.8rem" }}>{t.playground.note}</span>
          <button type="submit" disabled={busy}>
            {busy ? t.playground.generating : t.playground.generate}
          </button>
        </div>
      </form>

      {error && (
        <div className="card" style={{ marginTop: "1rem", borderColor: "var(--err)" }}>
          <strong style={{ color: "var(--err)" }}>{t.common.error}:</strong> {error}
        </div>
      )}

      {usage && (
        <div className="grid-4" style={{ marginTop: "1rem" }}>
          <div className="card">
            <div className="stat-label">{t.playground.costLast}</div>
            <div className="stat-value">${usage.costUsd.toFixed(6)}</div>
          </div>
          <div className="card">
            <div className="stat-label">{t.playground.totalTokens}</div>
            <div className="stat-value">{usage.totalTokens.toLocaleString()}</div>
          </div>
          <div className="card">
            <div className="stat-label">{t.playground.latency}</div>
            <div className="stat-value">{(usage.durationMs / 1000).toFixed(1)}s</div>
          </div>
          <div className="card">
            <div className="stat-label">{t.playground.model}</div>
            <div className="stat-value" style={{ fontSize: "1rem" }}>{usage.model}</div>
          </div>
        </div>
      )}

      {contract && (
        <>
          <h2>{t.playground.sectionsFor} {contract.id.slice(0, 10)}…</h2>
          <div dir={dir}>
            {contract.document.sections.map((s) => (
              <div className="section-card" key={s.id}>
                <header>
                  <h4>
                    {s.title}{" "}
                    <span className="muted mono" style={{ fontSize: "0.75rem", marginInlineStart: "0.5rem" }}>
                      {s.id}
                    </span>
                  </h4>
                  <button
                    className="ghost"
                    onClick={() => {
                      setEditingId(editingId === s.id ? null : s.id);
                      setEditInstruction("");
                    }}
                  >
                    {editingId === s.id ? t.playground.cancel : t.playground.edit}
                  </button>
                </header>
                <div className="section-content">{s.content}</div>
                {editingId === s.id && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label>{t.playground.editInstruction}</label>
                    <textarea
                      value={editInstruction}
                      onChange={(e) => setEditInstruction(e.target.value)}
                      placeholder={t.playground.editPlaceholder}
                      style={{ minHeight: "5rem" }}
                    />
                    <div style={{ marginTop: "0.5rem", textAlign: "end" }}>
                      <button
                        onClick={() => applyEdit(s.id)}
                        disabled={editBusy || !editInstruction.trim()}
                      >
                        {editBusy ? t.playground.editing : t.playground.applyEdit}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
