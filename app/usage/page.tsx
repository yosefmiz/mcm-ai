"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "../components/LocaleProvider";
import { formatUsd } from "@/lib/usage";

interface Log {
  id: string;
  contractId: string | null;
  operation: string;
  sectionId: string | null;
  model: string;
  jurisdiction: string;
  language: string;
  type: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  costUsd: string | number;
  status: string;
  createdAt: string;
}

interface UsageData {
  rates: { inputPerM: number; outputPerM: number };
  totals: {
    _sum: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      durationMs: number | null;
      costUsd: string | null;
    };
    _count: { _all: number };
  };
  byOperation: {
    operation: string;
    _count: { _all: number };
    _sum: { totalTokens: number | null; costUsd: string | null };
  }[];
  logs: Log[];
}

export default function UsagePage() {
  const t = useT();
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    fetch("/api/usage?take=100")
      .then((r) => r.json())
      .then((d) => {
        if (!canceled) setData(d);
      })
      .catch((e) => {
        if (!canceled) setError((e as Error).message);
      });
    return () => {
      canceled = true;
    };
  }, []);

  if (error) {
    return (
      <main>
        <h1>{t.usage.title}</h1>
        <div className="card" style={{ borderColor: "var(--err)", marginTop: "1rem" }}>
          <strong style={{ color: "var(--err)" }}>{t.common.error}:</strong> {error}
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main>
        <h1>{t.usage.title}</h1>
        <p className="muted">…</p>
      </main>
    );
  }

  const totalCost = data.totals._sum.costUsd ?? "0";
  const totalTokens = data.totals._sum.totalTokens ?? 0;
  const totalDurMs = data.totals._sum.durationMs ?? 0;
  const calls = data.totals._count._all;

  const opAgg = (op: string) => data.byOperation.find((b) => b.operation === op);
  const generateAgg = opAgg("GENERATE");
  const editAgg = opAgg("EDIT");
  const chatAgg = opAgg("CHAT");

  const opCard = (
    title: string,
    desc: string,
    agg: { _count: { _all: number }; _sum: { totalTokens: number | null; costUsd: string | null } } | undefined,
  ) => (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted">{desc}</p>
      <p>
        {t.usage.calls}: <strong>{agg?._count._all ?? 0}</strong>
      </p>
      <p>
        {t.usage.tokens}: <strong>{(agg?._sum.totalTokens ?? 0).toLocaleString()}</strong>
      </p>
      <p>
        {t.usage.cost}: <strong>{formatUsd(agg?._sum.costUsd ?? "0")}</strong>
      </p>
    </div>
  );

  return (
    <main>
      <h1>{t.usage.title}</h1>
      <p className="muted">
        {t.usage.subtitle} <strong>${data.rates.inputPerM}/M</strong> {t.usage.ratesInput},{" "}
        <strong>${data.rates.outputPerM}/M</strong> {t.usage.ratesOutput}. {t.usage.overrideVia}{" "}
        <span className="mono">COST_PER_M_INPUT_USD</span> /{" "}
        <span className="mono">COST_PER_M_OUTPUT_USD</span>.
      </p>

      <div className="grid-4" style={{ marginTop: "1rem" }}>
        <div className="card">
          <div className="stat-label">{t.usage.totalCost}</div>
          <div className="stat-value">{formatUsd(totalCost)}</div>
        </div>
        <div className="card">
          <div className="stat-label">{t.usage.totalCalls}</div>
          <div className="stat-value">{calls}</div>
        </div>
        <div className="card">
          <div className="stat-label">{t.usage.totalTokens}</div>
          <div className="stat-value">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="stat-label">{t.usage.totalCompute}</div>
          <div className="stat-value">{(totalDurMs / 60000).toFixed(1)}m</div>
        </div>
      </div>

      <h2>{t.usage.byOperation}</h2>
      <div className="grid-3">
        {opCard("GENERATE", t.usage.fullDrafting, generateAgg)}
        {opCard("EDIT", t.usage.partialEdit, editAgg)}
        {opCard("CHAT", t.usage.freeFormChat, chatAgg)}
      </div>

      <h2>{t.usage.recentCalls(data.logs.length)}</h2>
      {data.logs.length === 0 ? (
        <p className="muted">
          {t.usage.none} <Link href="/playground">{t.usage.tryPlayground}</Link>.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Op</th>
                <th>{t.history.contractLabel}</th>
                <th>{t.usage.tokens}</th>
                <th>{t.playground.latency}</th>
                <th>{t.usage.cost}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((u) => (
                <tr key={u.id}>
                  <td className="muted">{new Date(u.createdAt).toISOString().slice(0, 19).replace("T", " ")}</td>
                  <td>{u.operation}</td>
                  <td className="mono">
                    {u.contractId ? (
                      <Link href={`/history/${u.contractId}`}>{u.contractId.slice(0, 8)}…</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{u.totalTokens}</td>
                  <td>{(u.durationMs / 1000).toFixed(1)}s</td>
                  <td>${Number(u.costUsd).toFixed(6)}</td>
                  <td>
                    <span className={`pill pill-${u.status === "OK" ? "ok" : "err"}`}>{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
