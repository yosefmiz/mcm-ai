import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HistoryPage() {
  const contracts = await prisma.contract.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      jurisdiction: true,
      language: true,
      type: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { usageLogs: true } },
    },
  });

  return (
    <main>
      <h1>History</h1>
      <p className="muted">All contracts in the database, newest first. {contracts.length} shown.</p>

      {contracts.length === 0 ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          <p className="muted">No contracts yet. Generate one in the <Link href="/playground">Playground</Link>.</p>
        </div>
      ) : (
        <table className="table" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Lang</th>
              <th>Jurisdiction</th>
              <th>Calls</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td className="mono"><Link href={`/history/${c.id}`}>{c.id.slice(0, 12)}…</Link></td>
                <td>{c.type}</td>
                <td>{c.language}</td>
                <td>{c.jurisdiction}</td>
                <td>{c._count.usageLogs}</td>
                <td className="muted">{c.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td className="muted">{c.updatedAt.toISOString().slice(0, 19).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
