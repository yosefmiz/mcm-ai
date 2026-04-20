import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  GenerateRequestSchema,
  EditRequestSchema,
  AcceptRequestSchema,
  ContractDocumentSchema,
  type ContractSection,
  type TranslateTo,
} from "@/lib/schemas";
import {
  generateInitialContract,
  editContractSection,
  translateSection,
  type UsageInfo,
} from "@/lib/ai";
import { computeCostUsd } from "@/lib/usage";
import { fetchAndSerializeDealContext } from "@/lib/context-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// ---------------------------------------------------------------------------
// Audit-trail helpers
// ---------------------------------------------------------------------------

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

// ---------------------------------------------------------------------------
// GET — list recent contracts
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 50), 200);

  const contracts = await prisma.contract.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      jurisdiction: true,
      jurisdictionLanguage: true,
      bridgeLanguage: true,
      uiLanguage: true,
      type: true,
      dealId: true,
      uiLanguageAcceptedAt: true,
      acceptedByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ contracts });
}

// ---------------------------------------------------------------------------
// POST — generate primary contract immediately, fire async translations
// Body: {
//   jurisdictionLanguage,
//   translateTo?: { bridge?: string, ui?: string },
//   propertyId?, tenantId?, dealId?,
//   jurisdiction?, type?, inputs?,
//   acceptedByUserId?
// }
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const ip = clientIp(req);

  const ctx = await fetchAndSerializeDealContext(prisma, {
    propertyId: data.propertyId,
    tenantId: data.tenantId,
    dealId: data.dealId,
  });

  const jurisdiction = ctx.property?.jurisdiction ?? data.jurisdiction ?? null;
  const type = ctx.deal?.contractType ?? data.type ?? null;
  if (!jurisdiction || !type) {
    return NextResponse.json(
      {
        error:
          "Could not determine jurisdiction or contract type — provide them explicitly or attach a CRM entity that carries them",
      },
      { status: 400 },
    );
  }

  const inputs: Record<string, unknown> = { ...(data.inputs ?? {}) };

  let docResult;
  try {
    docResult = await generateInitialContract({
      jurisdiction,
      jurisdictionLanguage: data.jurisdictionLanguage,
      type,
      inputs,
      dealFacts: ctx.factSheet,
      prisma,
    });
  } catch (e) {
    await logUsage({
      operation: "GENERATE",
      jurisdiction,
      languageEnum: isoToEnum(data.jurisdictionLanguage) ?? "EN",
      type,
      sectionId: null,
      contractId: null,
      usage: emptyUsage(),
      status: "ERROR",
      error: (e as Error).message,
    });
    return NextResponse.json(
      { error: "Generation failed", detail: (e as Error).message },
      { status: 502 },
    );
  }

  const saved = await prisma.contract.create({
    data: {
      jurisdiction,
      jurisdictionLanguage: data.jurisdictionLanguage,
      // Stamp these only when the caller asked for translations — they
      // describe the LANGUAGES the bridge/ui translations will be in,
      // even before those columns are populated.
      bridgeLanguage: data.translateTo?.bridge ?? null,
      uiLanguage: data.translateTo?.ui ?? null,
      type,
      metadata: docResult.document.metadata as unknown as Prisma.InputJsonValue,
      sections: docResult.document.sections as unknown as Prisma.InputJsonValue,
      dealId: ctx.deal?.id ?? null,
      acceptedByUserId: data.acceptedByUserId ?? null,
      uiLanguageAcceptedAt: data.acceptedByUserId ? new Date() : null,
      userIpAddress: ip,
    },
    select: { id: true, createdAt: true },
  });

  await logUsage({
    operation: "GENERATE",
    jurisdiction,
    languageEnum: isoToEnum(data.jurisdictionLanguage) ?? "EN",
    type,
    sectionId: null,
    contractId: saved.id,
    usage: docResult.usage,
    status: "OK",
    error: null,
  });

  // ---- fire-and-return: schedule async translations via next/server after() ----
  // Runs after the response is sent to the client. On Vercel this uses the
  // platform's continuation; on Node.js (Render) it's just a deferred Promise.
  if (data.translateTo) {
    const translatePlan: TranslateTo = data.translateTo;
    after(async () => {
      try {
        await translateContractInBackground({
          contractId: saved.id,
          sourceLanguage: data.jurisdictionLanguage,
          translateTo: translatePlan,
          jurisdiction,
        });
      } catch (e) {
        await logUsage({
          operation: "EDIT",
          jurisdiction,
          languageEnum: isoToEnum(data.jurisdictionLanguage) ?? "EN",
          type,
          sectionId: "background_translate",
          contractId: saved.id,
          usage: emptyUsage(),
          status: "ERROR",
          error: (e as Error).message,
        });
      }
    });
  }

  return NextResponse.json(
    {
      id: saved.id,
      createdAt: saved.createdAt,
      document: docResult.document,
      dealFacts: ctx.factSheet,
      missing: ctx.missing,
      // Surface to the client whether async work is in flight; they can
      // poll GET /api/contract/:id and watch for content_bridge / content_ui
      // becoming non-empty.
      translationsPending: data.translateTo
        ? Object.entries(data.translateTo)
            .filter(([, v]) => !!v)
            .map(([k]) => k)
        : [],
      usage: {
        ...docResult.usage,
        costUsd: computeCostUsd(docResult.usage.inputTokens, docResult.usage.outputTokens),
      },
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// Background translation worker (called from after(), not by HTTP)
// ---------------------------------------------------------------------------

async function translateContractInBackground(args: {
  contractId: string;
  sourceLanguage: string;
  translateTo: TranslateTo;
  jurisdiction: string;
}): Promise<void> {
  for (const target of ["bridge", "ui"] as const) {
    const targetLanguage = args.translateTo[target];
    if (!targetLanguage) continue;
    await translateAllSectionsToTarget({
      contractId: args.contractId,
      sourceLanguage: args.sourceLanguage,
      target,
      targetLanguage,
      jurisdiction: args.jurisdiction,
    });
  }
}

async function translateAllSectionsToTarget(args: {
  contractId: string;
  sourceLanguage: string;
  target: "bridge" | "ui";
  targetLanguage: string;
  jurisdiction: string;
}): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: args.contractId },
  });
  if (!contract) return;

  const sectionsParse = ContractDocumentSchema.shape.sections.safeParse(contract.sections);
  if (!sectionsParse.success) return;

  const sections = sectionsParse.data;
  const targetField: keyof ContractSection =
    args.target === "bridge" ? "content_bridge" : "content_ui";

  const updated: ContractSection[] = sections.slice();
  let totalUsage: UsageInfo = emptyUsage();

  for (const s of sections) {
    if (s[targetField] !== "") continue; // already translated
    try {
      const out = await translateSection({
        jurisdiction: args.jurisdiction,
        sectionId: s.id,
        sourceLanguage: args.sourceLanguage,
        targetLanguage: args.targetLanguage,
        sourceContent: s.content_legal,
        prisma,
      });
      const idx = updated.findIndex((u) => u.id === s.id);
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], [targetField]: out.content };
        // Save incrementally so a poller can see partial progress.
        await prisma.contract.update({
          where: { id: args.contractId },
          data: { sections: updated as unknown as Prisma.InputJsonValue },
        });
      }
      totalUsage = sumUsage(totalUsage, out.usage);
    } catch (e) {
      await logUsage({
        operation: "EDIT",
        jurisdiction: args.jurisdiction,
        languageEnum: isoToEnum(args.targetLanguage) ?? "EN",
        type: contract.type,
        sectionId: `${args.target}:${s.id}`,
        contractId: args.contractId,
        usage: emptyUsage(),
        status: "ERROR",
        error: (e as Error).message,
      });
    }
  }

  await logUsage({
    operation: "EDIT",
    jurisdiction: args.jurisdiction,
    languageEnum: isoToEnum(args.targetLanguage) ?? "EN",
    type: contract.type,
    sectionId: `bg_translate:${args.target}`,
    contractId: args.contractId,
    usage: totalUsage,
    status: "OK",
    error: null,
  });
}

function sumUsage(a: UsageInfo, b: UsageInfo): UsageInfo {
  return {
    model: b.model || a.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    durationMs: a.durationMs + b.durationMs,
  };
}

// ---------------------------------------------------------------------------
// PATCH — partial section edit; re-injects deal facts so the model
// preserves names/amounts when revising.
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = EditRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { contractId, sectionId, userInstruction, acceptedByUserId } = parsed.data;

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const sectionsParse = ContractDocumentSchema.shape.sections.safeParse(contract.sections);
  if (!sectionsParse.success) {
    return NextResponse.json(
      { error: "Stored contract sections are corrupt", issues: sectionsParse.error.issues },
      { status: 500 },
    );
  }
  const sections = sectionsParse.data;
  const target = sections.find((s) => s.id === sectionId);
  if (!target) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const ctx = contract.dealId
    ? await fetchAndSerializeDealContext(prisma, { dealId: contract.dealId })
    : { factSheet: "" };

  let editResult;
  try {
    editResult = await editContractSection({
      jurisdiction: contract.jurisdiction,
      jurisdictionLanguage: contract.jurisdictionLanguage,
      type: contract.type,
      sectionId,
      current: {
        content_legal: target.content_legal,
        content_bridge: target.content_bridge,
        content_ui: target.content_ui,
      },
      userInstruction,
      dealFacts: ctx.factSheet,
      prisma,
    });
  } catch (e) {
    await logUsage({
      operation: "EDIT",
      jurisdiction: contract.jurisdiction,
      languageEnum: isoToEnum(contract.jurisdictionLanguage) ?? "EN",
      type: contract.type,
      sectionId,
      contractId,
      usage: emptyUsage(),
      status: "ERROR",
      error: (e as Error).message,
    });
    return NextResponse.json(
      { error: "Edit failed", detail: (e as Error).message },
      { status: 502 },
    );
  }

  const updatedSections: ContractSection[] = sections.map((s) =>
    s.id === sectionId ? editResult.section : s,
  );

  const ip = clientIp(req);
  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: {
      sections: updatedSections as unknown as Prisma.InputJsonValue,
      uiLanguageAcceptedAt: acceptedByUserId ? new Date() : null,
      acceptedByUserId: acceptedByUserId ?? null,
      userIpAddress: acceptedByUserId ? ip : contract.userIpAddress,
    },
    select: { id: true, updatedAt: true },
  });

  await logUsage({
    operation: "EDIT",
    jurisdiction: contract.jurisdiction,
    languageEnum: isoToEnum(contract.jurisdictionLanguage) ?? "EN",
    type: contract.type,
    sectionId,
    contractId,
    usage: editResult.usage,
    status: "OK",
    error: null,
  });

  // If the contract had translations and the user edited a section, the
  // bridge/ui versions of THAT section are now stale (cleared by the AI
  // result). Auto re-translate them in the background.
  if (contract.bridgeLanguage || contract.uiLanguage) {
    const sourceLang = contract.jurisdictionLanguage;
    const bridgeLang = contract.bridgeLanguage;
    const uiLang = contract.uiLanguage;
    const jurisdictionStr = contract.jurisdiction;

    after(async () => {
      try {
        for (const target of ["bridge", "ui"] as const) {
          const targetLang = target === "bridge" ? bridgeLang : uiLang;
          if (!targetLang) continue;
          await translateAllSectionsToTarget({
            contractId,
            sourceLanguage: sourceLang,
            target,
            targetLanguage: targetLang,
            jurisdiction: jurisdictionStr,
          });
        }
      } catch {
        /* logged inside */
      }
    });
  }

  return NextResponse.json({
    id: updated.id,
    updatedAt: updated.updatedAt,
    section: editResult.section,
    translationsPending: [
      contract.bridgeLanguage ? "bridge" : null,
      contract.uiLanguage ? "ui" : null,
    ].filter((x): x is string => !!x),
    usage: {
      ...editResult.usage,
      costUsd: computeCostUsd(editResult.usage.inputTokens, editResult.usage.outputTokens),
    },
  });
}

// ---------------------------------------------------------------------------
// PUT — record user acceptance (audit trail only)
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = AcceptRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { contractId, acceptedByUserId } = parsed.data;
  const ip = clientIp(req);

  try {
    const updated = await prisma.contract.update({
      where: { id: contractId },
      data: {
        uiLanguageAcceptedAt: new Date(),
        acceptedByUserId,
        userIpAddress: ip,
      },
      select: {
        id: true,
        uiLanguageAcceptedAt: true,
        acceptedByUserId: true,
        userIpAddress: true,
      },
    });
    return NextResponse.json({ acceptance: updated });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Acceptance failed", detail: (e as Error).message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isoToEnum(iso: string): "HE" | "EN" | "RU" | "AR" | null {
  switch (iso.toLowerCase().split("-")[0]) {
    case "he": return "HE";
    case "en": return "EN";
    case "ru": return "RU";
    case "ar": return "AR";
    default:   return null;
  }
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

async function logUsage(args: {
  operation: "GENERATE" | "EDIT";
  jurisdiction: string;
  languageEnum: "HE" | "EN" | "RU" | "AR";
  type: "ANNUAL" | "SUBLET" | "MANAGEMENT";
  sectionId: string | null;
  contractId: string | null;
  usage: UsageInfo;
  status: "OK" | "ERROR";
  error: string | null;
}): Promise<void> {
  const cost = computeCostUsd(args.usage.inputTokens, args.usage.outputTokens);
  try {
    await prisma.usageLog.create({
      data: {
        operation: args.operation,
        jurisdiction: args.jurisdiction,
        language: args.languageEnum,
        type: args.type,
        sectionId: args.sectionId,
        contractId: args.contractId,
        model: args.usage.model,
        inputTokens: args.usage.inputTokens,
        outputTokens: args.usage.outputTokens,
        totalTokens: args.usage.totalTokens,
        durationMs: args.usage.durationMs,
        costUsd: new Prisma.Decimal(cost.toFixed(6)),
        status: args.status,
        error: args.error,
      },
    });
  } catch {
    // best-effort
  }
}
