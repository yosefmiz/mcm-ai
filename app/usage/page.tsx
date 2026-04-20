import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatUsd, getRates } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function UsagePage() {
  const [logs, totals, byOp] = await Promise.all([
    prisma.usageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.usageLog.aggregate({
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        durationMs: true,
        costUsd: true,
      },
      _count: { _all: true },
    }),
    prisma.usageLog.groupBy({
      by: ["operation"],
      _count: { _all: true },
      _sum: { totalTokens: true, costUsd: true },
    }),
  ]);

  const rates = getRates();
  const totalCost = totals._sum.costUsd?.toString() ?? "0";
  const totalTokens = totals._sum.totalTokens ?? 0;
  const totalDurMs = totals._sum.durationMs ?? 0;
  const calls = totals._count._all;

  const generateAgg = byOp.find((b) => b.operation === "GENERATE");
  const editAgg = byOp.find((b) => b.operation === "EDIT");

  return (
    <main>
      <h1>Usage</h1>
      <p className="muted">
        Token consumption, latency, and cost across every AI call. Rates: <strong>${rates.inputPerM}/M</strong> input, <strong>${rates.outputPerM}/M</strong> output.
        Override via <span className="mono">COST_PER_M_INPUT_USD</span> / <span className="mono">COST_PER_M_OUTPUT_USD</span>.
      </p>

      <div className="grid-4" style={{ marginTop: "1rem" }}>
        <div className="card">
          <div className="stat-label">Total cost</div>
          <div className="stat-value">{formatUsd(totalCost)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Total calls</div>
          <div className="stat-value">{calls}</div>
        </div>
        <div className="card">
          <div className="stat-label">Total tokens</div>
          <div className="stat-value">{totalTokens.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="stat-label">Total compute</div>
          <div className="stat-value">{(totalDurMs / 60000).toFixed(1)}m</div>
        </div>
      </div>

      <h2>By operation</h2>
      <div className="grid-2">
        <div className="card">
          <h3>GENERATE</h3>
          <p className="muted">Full contract drafting</p>
          <p>Calls: <strong>{generateAgg?._count._all ?? 0}</strong></p>
          <p>Tokens: <strong>{(generateAgg?._sum.totalTokens ?? 0).toLocaleString()}</strong></p>
          <p>Cost: <strong>{formatUsd(generateAgg?._sum.costUsd?.toString() ?? "0")}</strong></p>
        </div>
        <div className="card">
          <h3>EDIT</h3>
          <p className="muted">Per-section partial edit</p>
          <p>Calls: <strong>{editAgg?._count._all ?? 0}</strong></p>
          <p>Tokens: <strong>{(editAgg?._sum.totalTokens ?? 0).toLocaleString()}</strong></p>
          <p>Cost: <strong>{formatUsd(editAgg?._sum.costUsd?.toString() ?? "0")}</strong></p>
        </div>
      </div>

      <h2>Recent calls ({logs.length})</h2>
      {logs.length === 0 ? (
        <p className="muted">No usage yet. Try the <Link href="/playground">Playground</Link>.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Op</th>
                <th>Contract</th>
                <th>Section</th>
                <th>Lang</th>
                <th>Type</th>
                <th>Model</th>
                <th>In</th>
                <th>Out</th>
                <th>Time</th>
                <th>Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((u) => (
                <tr key={u.id}>
                  <td className="muted">{u.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                  <td>{u.operation}</td>
                  <td className="mono">
                    {u.contractId ? <Link href={`/history/${u.contractId}`}>{u.contractId.slice(0, 8)}…</Link> : "—"}
                  </td>
                  <td className="mono">{u.sectionId ?? "—"}</td>
                  <td>{u.language}</td>
                  <td>{u.type}</td>
                  <td className="mono">{u.model}</td>
                  <td>{u.inputTokens}</td>
                  <td>{u.outputTokens}</td>
                  <td>{(u.durationMs / 1000).toFixed(1)}s</td>
                  <td>{formatUsd(u.costUsd.toString())}</td>
                  <td><span className={`pill pill-${u.status === "OK" ? "ok" : "err"}`}>{u.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
