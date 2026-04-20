import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  ApplyFactsRequestSchema,
  ContractDocumentSchema,
} from "@/lib/schemas";
import {
  applyFactsToSections,
  collectPlaceholders,
  extractFactsFromInstruction,
} from "@/lib/ai";
import { computeCostUsd } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// PATCH /api/contract/:id/facts
// Body: { facts?: Record<string,string>, instruction?: string }
//
// Substitutes [[FIELD_NAME]] placeholders across all 3 columns of every
// section. If `instruction` is given (free-text natural language) it is
// first parsed by gemma4 into a facts map, then applied.
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = ApplyFactsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const sectionsParse = ContractDocumentSchema.shape.sections.safeParse(
    contract.sections,
  );
  if (!sectionsParse.success) {
    return NextResponse.json(
      { error: "Stored contract sections are corrupt" },
      { status: 500 },
    );
  }
  const sections = sectionsParse.data;
  const knownPlaceholders = collectPlaceholders(sections);

  let facts: Record<string, string> = {};
  let extractionUsage: { totalTokens: number; durationMs: number; costUsd: number } | null = null;

  if (parsed.data.instruction) {
    try {
      const out = await extractFactsFromInstruction(
        parsed.data.instruction,
        knownPlaceholders,
      );
      facts = out.facts;
      extractionUsage = {
        totalTokens: out.usage.totalTokens,
        durationMs: out.usage.durationMs,
        costUsd: computeCostUsd(out.usage.inputTokens, out.usage.outputTokens),
      };
    } catch (e) {
      return NextResponse.json(
        { error: "Fact extraction failed", detail: (e as Error).message },
        { status: 502 },
      );
    }
  }

  if (parsed.data.facts) {
    facts = { ...facts, ...parsed.data.facts };
  }

  if (Object.keys(facts).length === 0) {
    return NextResponse.json({
      id,
      facts: {},
      appliedKeys: [],
      remainingPlaceholders: knownPlaceholders,
      extractionUsage,
      message: "No facts extracted; nothing to apply.",
    });
  }

  const { sections: updatedSections, appliedKeys } = applyFactsToSections(
    sections,
    facts,
  );

  const updated = await prisma.contract.update({
    where: { id },
    data: {
      sections: updatedSections as unknown as Prisma.InputJsonValue,
      // Mutating the contract invalidates the previously-recorded acceptance.
      uiLanguageAcceptedAt: null,
      acceptedByUserId: null,
    },
    select: { id: true, updatedAt: true, sections: true },
  });

  const remainingParse = ContractDocumentSchema.shape.sections.safeParse(updated.sections);
  const remaining = remainingParse.success ? collectPlaceholders(remainingParse.data) : [];

  return NextResponse.json({
    id: updated.id,
    updatedAt: updated.updatedAt,
    facts,
    appliedKeys,
    unmatchedKeys: Object.keys(facts).filter((k) => !appliedKeys.includes(k)),
    remainingPlaceholders: remaining,
    sections: updatedSections,
    extractionUsage,
  });
}

// ---------------------------------------------------------------------------
// GET /api/contract/:id/facts — list outstanding placeholders
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { sections: true },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  const parsed = ContractDocumentSchema.shape.sections.safeParse(contract.sections);
  if (!parsed.success) {
    return NextResponse.json({ placeholders: [] });
  }
  return NextResponse.json({ placeholders: collectPlaceholders(parsed.data) });
}
