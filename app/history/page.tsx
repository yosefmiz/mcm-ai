"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "../components/LocaleProvider";

interface Row {
  id: string;
  jurisdiction: string;
  jurisdictionLanguage: string;
  bridgeLanguage: string;
  uiLanguage: string;
  type: string;
  uiLanguageAcceptedAt: string | null;
  acceptedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function HistoryPage() {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    fetch("/api/contract?take=100")
      .then((r) => r.json())
      .then((data) => {
        if (!canceled) setRows(data.contracts ?? []);
      })
      .catch((e) => {
        if (!canceled) setError((e as Error).message);
      });
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <main>
      <h1>{t.history.title}</h1>
      <p className="muted">{t.history.subtitle(rows?.length ?? 0)}</p>

      {error && (
        <div className="card" style={{ marginTop: "1rem", borderColor: "var(--err)" }}>
          <strong style={{ color: "var(--err)" }}>{t.common.error}:</strong> {error}
        </div>
      )}

      {rows && rows.length === 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="muted">
            {t.history.none} <Link href="/playground">{t.history.inPlayground}</Link>.
          </p>
        </div>
      ) : rows ? (
        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>{t.playground.type}</th>
              <th>{t.playground.jurisdiction}</th>
              <th>Legal</th>
              <th>Bridge</th>
              <th>UI</th>
              <th>Accepted</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="mono">
                  <Link href={`/history/${c.id}`}>{c.id.slice(0, 12)}…</Link>
                </td>
                <td>{c.type}</td>
                <td>{c.jurisdiction}</td>
                <td>{c.jurisdictionLanguage}</td>
                <td>{c.bridgeLanguage}</td>
                <td>{c.uiLanguage}</td>
                <td>
                  {c.uiLanguageAcceptedAt
                    ? <span className="pill pill-ok">✓</span>
                    : <span className="muted">—</span>}
                </td>
                <td className="muted">{new Date(c.createdAt).toISOString().slice(0, 19).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ marginTop: "1rem" }}>…</p>
      )}
    </main>
  );
}
