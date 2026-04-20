import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRates } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 100), 500);

  const [logs, totals, byOp] = await Promise.all([
    prisma.usageLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        contractId: true,
        operation: true,
        sectionId: true,
        model: true,
        jurisdiction: true,
        language: true,
        type: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        durationMs: true,
        costUsd: true,
        status: true,
        createdAt: true,
      },
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
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        costUsd: true,
      },
    }),
  ]);

  return NextResponse.json({
    rates: getRates(),
    totals,
    byOperation: byOp,
    logs,
  });
}
