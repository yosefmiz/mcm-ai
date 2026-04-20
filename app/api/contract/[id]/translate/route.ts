import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  TranslateRequestSchema,
  ContractDocumentSchema,
  type ContractSection,
} from "@/lib/schemas";
import { translateSection, type UsageInfo } from "@/lib/ai";
import { computeCostUsd } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// ---------------------------------------------------------------------------
// POST /api/contract/:id/translate
// Body: { target: "bridge" | "ui", sectionId?: string }
//
// Translates the legal column into the contract's bridge or ui language.
// By default translates EVERY section whose target column is empty; pass
// sectionId to translate just one. Re-running on a populated column
// re-translates (overwrites).
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = TranslateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { target, sectionId: onlySectionId } = parsed.data;

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const sectionsParse = ContractDocumentSchema.shape.sections.safeParse(contract.sections);
  if (!sectionsParse.success) {
    return NextResponse.json({ error: "Stored sections are corrupt" }, { status: 500 });
  }
  const sections = sectionsParse.data;

  const targetLanguage = target === "bridge" ? contract.bridgeLanguage : contract.uiLanguage;
  const sourceLanguage = contract.jurisdictionLanguage;
  const targetField: keyof ContractSection = target === "bridge" ? "content_bridge" : "content_ui";

  // Decide what to translate.
  const queue = sections.filter((s) => {
    if (onlySectionId && s.id !== onlySectionId) return false;
    if (onlySectionId) return true; // explicit single-section: always translate
    return s[targetField] === ""; // batch: only untranslated
  });

  if (queue.length === 0) {
    return NextResponse.json({
      id,
      target,
      translatedCount: 0,
      message: onlySectionId ? "Section not found" : "All sections already translated",
    });
  }

  const updated: ContractSection[] = sections.slice();
  let totalUsage: UsageInfo = {
    model: process.env.OLLAMA_MODEL ?? "gemma4",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };

  for (const s of queue) {
    try {
      const out = await translateSection({
        jurisdiction: contract.jurisdiction,
        sectionId: s.id,
        sourceLanguage,
        targetLanguage,
        sourceContent: s.content_legal,
        prisma,
      });
      const idx = updated.findIndex((u) => u.id === s.id);
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], [targetField]: out.content };
      }
      totalUsage = sumUsage(totalUsage, out.usage);
    } catch (e) {
      // Best-effort: log and continue with the rest of the batch.
      await logTranslation(contract.id, s.id, target, emptyUsage(), "ERROR", (e as Error).message);
    }
  }

  await prisma.contract.update({
    where: { id },
    data: {
      sections: updated as unknown as Prisma.InputJsonValue,
      uiLanguageAcceptedAt: null,
      acceptedByUserId: null,
    },
    select: { id: true },
  });

  await logTranslation(contract.id, null, target, totalUsage, "OK", null);

  return NextResponse.json({
    id,
    target,
    translatedCount: queue.length,
    sections: updated,
    usage: {
      ...totalUsage,
      costUsd: computeCostUsd(totalUsage.inputTokens, totalUsage.outputTokens),
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumUsage(a: UsageInfo, b: UsageInfo): UsageInfo {
  return {
    model: b.model || a.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    durationMs: a.durationMs + b.durationMs,
  };
}

function emptyUsage(): UsageInfo {
  return {
    model: process.env.OLLAMA_MODEL ?? "gemma4",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };
}

async function logTranslation(
  contractId: string,
  sectionId: string | null,
  target: "bridge" | "ui",
  usage: UsageInfo,
  status: "OK" | "ERROR",
  error: string | null,
): Promise<void> {
  const cost = computeCostUsd(usage.inputTokens, usage.outputTokens);
  try {
    await prisma.usageLog.create({
      data: {
        operation: "EDIT", // closest existing enum; reused for translations
        jurisdiction: "-",
        language: "EN",
        type: "ANNUAL",
        sectionId: sectionId ? `${target}:${sectionId}` : `translate:${target}`,
        contractId,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        durationMs: usage.durationMs,
        costUsd: new Prisma.Decimal(cost.toFixed(6)),
        status,
        error,
      },
    });
  } catch {
    /* best-effort */
  }
}
