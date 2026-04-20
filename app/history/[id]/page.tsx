"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { use } from "react";
import { useT } from "../../components/LocaleProvider";

const RTL = new Set(["HE", "AR"]);

interface Section { id: string; title: string; content: string }
interface UsageLog {
  id: string; operation: string; sectionId: string | null;
  inputTokens: number; outputTokens: number; durationMs: number;
  costUsd: string | number; status: string; createdAt: string;
}
interface Contract {
  id: string; jurisdiction: string; language: string; type: string;
  metadata: unknown;
  sections: Section[];
  createdAt: string; updatedAt: string;
  usageLogs?: UsageLog[];
}

export default function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useT();
  const [contract, setContract] = useState<Contract | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const dir = RTL.has(contract.language) ? "rtl" : "ltr";
  const sections = Array.isArray(contract.sections) ? contract.sections : [];
  const logs = contract.usageLogs ?? [];

  return (
    <main>
      <p className="muted"><Link href="/history">{t.history.back}</Link></p>
      <h1>
        {t.history.contractLabel}{" "}
        <span className="mono" style={{ fontSize: "1rem" }}>{contract.id}</span>
      </h1>
      <p className="muted">
        {contract.type} · {contract.language} · {contract.jurisdiction} · {new Date(contract.createdAt).toISOString().slice(0, 19).replace("T", " ")}
      </p>

      <h2>{t.history.sectionsHeading}</h2>
      <div dir={dir}>
        {sections.map((s) => (
          <div className="section-card" key={s.id}>
            <header>
              <h4>
                {s.title}{" "}
                <span className="muted mono" style={{ fontSize: "0.75rem", marginInlineStart: "0.5rem" }}>
                  {s.id}
                </span>
              </h4>
            </header>
            <div className="section-content">{s.content}</div>
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
              <th>{t.usage.recentCalls(0).split("(")[0].trim() || "Time"}</th>
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
