import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ContractDocumentSchema } from "@/lib/schemas";
import { formatUsd } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RTL = new Set(["HE", "AR"]);

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      usageLogs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!contract) notFound();

  const sectionsParse = ContractDocumentSchema.shape.sections.safeParse(contract.sections);
  const sections = sectionsParse.success ? sectionsParse.data : [];
  const dir = RTL.has(contract.language) ? "rtl" : "ltr";

  return (
    <main>
      <p className="muted"><Link href="/history">← Back to history</Link></p>
      <h1>Contract <span className="mono" style={{ fontSize: "1rem" }}>{contract.id}</span></h1>
      <p className="muted">
        {contract.type} · {contract.language} · {contract.jurisdiction} · created {contract.createdAt.toISOString().slice(0, 19).replace("T", " ")}
      </p>

      <h2>Sections</h2>
      <div dir={dir}>
        {sections.map((s) => (
          <div className="section-card" key={s.id}>
            <header><h4>{s.title} <span className="muted mono" style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>{s.id}</span></h4></header>
            <div className="section-content">{s.content}</div>
          </div>
        ))}
      </div>

      <h2>Calls on this contract ({contract.usageLogs.length})</h2>
      {contract.usageLogs.length === 0 ? (
        <p className="muted">No usage logs.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Op</th>
              <th>Section</th>
              <th>In</th>
              <th>Out</th>
              <th>Time</th>
              <th>Cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {contract.usageLogs.map((u) => (
              <tr key={u.id}>
                <td className="muted">{u.createdAt.toISOString().slice(11, 19)}</td>
                <td>{u.operation}</td>
                <td className="mono">{u.sectionId ?? "—"}</td>
                <td>{u.inputTokens}</td>
                <td>{u.outputTokens}</td>
                <td>{(u.durationMs / 1000).toFixed(1)}s</td>
                <td>{formatUsd(u.costUsd.toString())}</td>
                <td><span className={`pill pill-${u.status === "OK" ? "ok" : "err"}`}>{u.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
