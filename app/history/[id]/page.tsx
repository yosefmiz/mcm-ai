"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { use } from "react";
import { useT } from "../../components/LocaleProvider";

const RTL = new Set(["he", "ar"]);

interface Section {
  id: string;
  content_legal: string;
  content_bridge: string;
  content_ui: string;
}
interface UsageLog {
  id: string;
  operation: string;
  sectionId: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: string | number;
  status: string;
  createdAt: string;
}
interface Contract {
  id: string;
  jurisdiction: string;
  type: string;
  jurisdictionLanguage: string;
  bridgeLanguage: string;
  uiLanguage: string;
  metadata: unknown;
  sections: Section[];
  uiLanguageAcceptedAt: string | null;
  acceptedByUserId: string | null;
  userIpAddress: string | null;
  createdAt: string;
  updatedAt: string;
  usageLogs?: UsageLog[];
}

type ColumnKey = "ui" | "legal" | "bridge";

export default function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useT();
  const [contract, setContract] = useState<Contract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<ColumnKey>("ui");

  useEffect(() => {
    let canceled = false;
    fetch(`/api/contract/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (canceled) return;
        if (data.error) setError(data.error);
        else setContract(data.contract);
      })
      .catch((e) => {
        if (!canceled) setError((e as Error).message);
      });
    return () => {
      canceled = true;
    };
  }, [id]);

  if (error) {
    return (
      <main>
        <p className="muted"><Link href="/history">{t.history.back}</Link></p>
        <div className="card" style={{ borderColor: "var(--err)", marginTop: "1rem" }}>
          <strong style={{ color: "var(--err)" }}>{t.common.error}:</strong> {error}
        </div>
      </main>
    );
  }

  if (!contract) {
    return (
      <main>
        <p className="muted"><Link href="/history">{t.history.back}</Link></p>
        <p className="muted" style={{ marginTop: "1rem" }}>…</p>
      </main>
    );
  }

  const colLang =
    activeColumn === "legal"
      ? contract.jurisdictionLanguage
      : activeColumn === "bridge"
        ? contract.bridgeLanguage
        : contract.uiLanguage;
  const dir = RTL.has(colLang.toLowerCase().split("-")[0]) ? "rtl" : "ltr";
  const sections = Array.isArray(contract.sections) ? contract.sections : [];
  const logs = contract.usageLogs ?? [];

  function colContent(s: Section): string {
    if (activeColumn === "legal") return s.content_legal;
    if (activeColumn === "bridge") return s.content_bridge;
    return s.content_ui;
  }

  return (
    <main>
      <p className="muted"><Link href="/history">{t.history.back}</Link></p>
      <h1>
        {t.history.contractLabel}{" "}
        <span className="mono" style={{ fontSize: "1rem" }}>{contract.id}</span>
      </h1>
      <p className="muted">
        {contract.type} · {contract.jurisdiction} · jurisdiction <strong>{contract.jurisdictionLanguage}</strong> · bridge <strong>{contract.bridgeLanguage}</strong> · UI <strong>{contract.uiLanguage}</strong> · {new Date(contract.createdAt).toISOString().slice(0, 19).replace("T", " ")}
      </p>

      {contract.uiLanguageAcceptedAt && (
        <div className="card" style={{ marginTop: "0.5rem", borderColor: "var(--ok)" }}>
          <strong style={{ color: "var(--ok)" }}>Accepted</strong>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            user <span className="mono">{contract.acceptedByUserId ?? "—"}</span>
            {" · "}IP <span className="mono">{contract.userIpAddress ?? "—"}</span>
            {" · "}at {new Date(contract.uiLanguageAcceptedAt).toISOString().slice(0, 19).replace("T", " ")}
          </p>
        </div>
      )}

      <h2 style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <span>{t.history.sectionsHeading}</span>
        <span className="row" style={{ gap: "0.25rem" }}>
          <button
            className={activeColumn === "ui" ? "" : "ghost"}
            onClick={() => setActiveColumn("ui")}
            type="button"
          >UI · {contract.uiLanguage}</button>
          <button
            className={activeColumn === "legal" ? "" : "ghost"}
            onClick={() => setActiveColumn("legal")}
            type="button"
          >Legal · {contract.jurisdictionLanguage}</button>
          <button
            className={activeColumn === "bridge" ? "" : "ghost"}
            onClick={() => setActiveColumn("bridge")}
            type="button"
          >Bridge · {contract.bridgeLanguage}</button>
        </span>
      </h2>

      <div dir={dir}>
        {sections.map((s) => (
          <div className="section-card" key={s.id}>
            <header>
              <h4>
                <span className="mono" style={{ fontSize: "0.85rem" }}>{s.id}</span>
              </h4>
            </header>
            <div className="section-content">{colContent(s)}</div>
          </div>
        ))}
      </div>

      <h2>{t.history.callsHeading(logs.length)}</h2>
      {logs.length === 0 ? (
        <p className="muted">{t.history.noLogs}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Op</th>
              <th>Section</th>
              <th>{t.usage.tokens}</th>
              <th>{t.usage.cost}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((u) => (
              <tr key={u.id}>
                <td className="muted">{new Date(u.createdAt).toISOString().slice(11, 19)}</td>
                <td>{u.operation}</td>
                <td className="mono">{u.sectionId ?? "—"}</td>
                <td>{u.inputTokens + u.outputTokens}</td>
                <td>${Number(u.costUsd).toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
