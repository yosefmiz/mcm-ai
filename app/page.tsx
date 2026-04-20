import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>MyHome AI</h1>
      <p className="muted">
        AI-powered real-estate contract generation. Multi-jurisdiction,
        multi-language, partial-edit aware.
      </p>

      <h2>Pages</h2>
      <div className="grid-3">
        <Link href="/playground" className="card">
          <h3>Playground</h3>
          <p className="muted">Generate a contract and edit sections inline.</p>
        </Link>
        <Link href="/history" className="card">
          <h3>History</h3>
          <p className="muted">Every contract ever generated, newest first.</p>
        </Link>
        <Link href="/usage" className="card">
          <h3>Usage</h3>
          <p className="muted">Per-call tokens, latency, and estimated cost.</p>
        </Link>
      </div>

      <h2>API</h2>
      <pre className="mono card">
{`POST   /api/contract        Generate full contract
PATCH  /api/contract        Edit a single section
GET    /api/contract        List recent contracts
GET    /api/contract/:id    Fetch one contract
GET    /api/usage           Usage logs and aggregates`}
      </pre>
    </main>
  );
}
