"use client";

import { useState } from "react";
import { useT } from "../components/LocaleProvider";

type Ctype = "ANNUAL" | "SUBLET" | "MANAGEMENT";
const RTL = new Set(["he", "ar"]);

interface Section {
  id: string;
  content_legal: string;
  content_bridge: string;
  content_ui: string;
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
    metadata: {
      jurisdiction: string;
      jurisdictionLanguage: string;
      bridgeLanguage: string;
      uiLanguage: string;
      type: Ctype;
    };
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

type ColumnKey = "ui" | "legal" | "bridge";

export default function Playground() {
  const t = useT();
  const [jurisdiction, setJurisdiction] = useState("NY, US");
  const [jurisdictionLanguage, setJL] = useState("en");
  const [bridgeLanguage, setBL] = useState("en");
  const [uiLang, setUL] = useState("en");
  const [type, setType] = useState<Ctype>("ANNUAL");
  const [inputsText, setInputsText] = useState(DEFAULT_INPUTS);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contract, setContract] = useState<GenResponse | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const [activeColumn, setActiveColumn] = useState<ColumnKey>("ui");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [factsBusy, setFactsBusy] = useState(false);
  const [factsInstruction, setFactsInstruction] = useState("");
  const [factsValues, setFactsValues] = useState<Record<string, string>>({});

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
        body: JSON.stringify({
          jurisdiction,
          jurisdictionLanguage,
          bridgeLanguage,
          uiLanguage: uiLang,
          type,
          inputs,
        }),
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

  // Detect placeholders across all sections + columns
  const placeholders = contract
    ? Array.from(
        new Set(
          contract.document.sections.flatMap((s) =>
            [s.content_legal, s.content_bridge, s.content_ui].flatMap((c) =>
              Array.from(c.matchAll(/\[\[([A-Z][A-Z0-9_]*)\]\]/g)).map((m) => m[1]),
            ),
          ),
        ),
      ).sort()
    : [];

  async function applyFacts(payload: { facts?: Record<string, string>; instruction?: string }) {
    if (!contract) return;
    setFactsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contract/${contract.id}/facts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Apply facts failed");
      if (data.sections) {
        setContract({
          ...contract,
          document: { ...contract.document, sections: data.sections },
        });
        setFactsValues({});
        setFactsInstruction("");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFactsBusy(false);
    }
  }

  const meta = contract?.document.metadata;
  const colLang = meta
    ? activeColumn === "legal"
      ? meta.jurisdictionLanguage
      : activeColumn === "bridge"
        ? meta.bridgeLanguage
        : meta.uiLanguage
    : "en";
  const dir = RTL.has(colLang.toLowerCase().split("-")[0]) ? "rtl" : "ltr";

  function columnContent(s: Section): string {
    if (activeColumn === "legal") return s.content_legal;
    if (activeColumn === "bridge") return s.content_bridge;
    return s.content_ui;
  }

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
              placeholder="NY, US / IL / DE-BE / GR"
              required
            />
          </div>
          <div>
            <label>{t.playground.type}</label>
            <select value={type} onChange={(e) => setType(e.target.value as Ctype)}>
              <option value="ANNUAL">{t.playground.typeAnnual}</option>
              <option value="SUBLET">{t.playground.typeSublet}</option>
              <option value="MANAGEMENT">{t.playground.typeManagement}</option>
            </select>
          </div>
          <div />
        </div>

        <div className="grid-3" style={{ marginTop: "0.75rem" }}>
          <div>
            <label>Jurisdiction language (legal, binding)</label>
            <input value={jurisdictionLanguage} onChange={(e) => setJL(e.target.value)} placeholder="en / he / el / de" required />
          </div>
          <div>
            <label>Bridge language (parties&apos; common)</label>
            <input value={bridgeLanguage} onChange={(e) => setBL(e.target.value)} placeholder="en / he / ru" required />
          </div>
          <div>
            <label>UI language (convenience)</label>
            <input value={uiLang} onChange={(e) => setUL(e.target.value)} placeholder="en / he / ru / ar" required />
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

      {contract && placeholders.length > 0 && (
        <div className="card" style={{ marginTop: "1rem", borderColor: "var(--warn)" }}>
          <h3 style={{ marginTop: 0 }}>
            Fill in missing details
            <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "0.5rem", fontWeight: 400 }}>
              {placeholders.length} placeholder{placeholders.length === 1 ? "" : "s"} detected
            </span>
          </h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Type the value for each, or describe everything in free text below — gemma4 will parse it.
          </p>

          <div className="grid-2" style={{ marginTop: "0.5rem" }}>
            {placeholders.map((key) => (
              <div key={key}>
                <label className="mono" style={{ fontSize: "0.7rem" }}>{key}</label>
                <input
                  value={factsValues[key] ?? ""}
                  onChange={(e) => setFactsValues({ ...factsValues, [key]: e.target.value })}
                  placeholder="value"
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: "0.75rem" }}>
            <label>Or describe in plain text (any language)</label>
            <textarea
              value={factsInstruction}
              onChange={(e) => setFactsInstruction(e.target.value)}
              placeholder='e.g. "המשכיר יוסי כהן, השוכר רני לוי, השכירות 4500 ש"ח, מתחיל ב-1 במאי 2026"'
              style={{ minHeight: "5rem" }}
            />
          </div>

          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              className="ghost"
              onClick={() => {
                setFactsValues({});
                setFactsInstruction("");
              }}
              disabled={factsBusy}
            >
              Clear
            </button>
            <button
              onClick={() => {
                const filled = Object.fromEntries(
                  Object.entries(factsValues).filter(([, v]) => v.trim().length > 0),
                );
                const payload: { facts?: Record<string, string>; instruction?: string } = {};
                if (Object.keys(filled).length > 0) payload.facts = filled;
                if (factsInstruction.trim().length > 0) payload.instruction = factsInstruction;
                if (!payload.facts && !payload.instruction) return;
                void applyFacts(payload);
              }}
              disabled={
                factsBusy ||
                (Object.values(factsValues).every((v) => !v.trim()) && !factsInstruction.trim())
              }
            >
              {factsBusy ? "Applying…" : "Apply facts"}
            </button>
          </div>
        </div>
      )}

      {contract && meta && (
        <>
          <h2 style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <span>{t.playground.sectionsFor} {contract.id.slice(0, 10)}…</span>
            <span className="row" style={{ gap: "0.25rem" }}>
              <button
                className={activeColumn === "ui" ? "" : "ghost"}
                onClick={() => setActiveColumn("ui")}
                type="button"
              >UI · {meta.uiLanguage}</button>
              <button
                className={activeColumn === "legal" ? "" : "ghost"}
                onClick={() => setActiveColumn("legal")}
                type="button"
              >Legal · {meta.jurisdictionLanguage}</button>
              <button
                className={activeColumn === "bridge" ? "" : "ghost"}
                onClick={() => setActiveColumn("bridge")}
                type="button"
              >Bridge · {meta.bridgeLanguage}</button>
            </span>
          </h2>

          <div dir={dir}>
            {contract.document.sections.map((s) => (
              <div className="section-card" key={s.id}>
                <header>
                  <h4>
                    <span className="mono" style={{ fontSize: "0.85rem" }}>{s.id}</span>
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
                <div className="section-content">{columnContent(s)}</div>
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
