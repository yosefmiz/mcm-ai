import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  GenerateRequestSchema,
  EditRequestSchema,
  AcceptRequestSchema,
  ContractDocumentSchema,
  ContractSectionSchema,
  type ContractSection,
} from "@/lib/schemas";
import {
  generateInitialContract,
  editContractSection,
  type UsageInfo,
} from "@/lib/ai";
import { computeCostUsd } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Audit-trail helpers
// ---------------------------------------------------------------------------

function clientIp(req: NextRequest): string | null {
  // Render / Vercel / Cloudflare style headers, in order of precedence.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/contract — list recent
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
      uiLanguageAcceptedAt: true,
      acceptedByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ contracts });
}

// ---------------------------------------------------------------------------
// POST /api/contract — Holy Trinity generation + audit-trail capture
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
  const {
    jurisdiction,
    jurisdictionLanguage,
    bridgeLanguage,
    uiLanguage,
    type,
    inputs,
    acceptedByUserId,
  } = parsed.data;

  const ip = clientIp(req);

  let docResult;
  try {
    docResult = await generateInitialContract({
      jurisdiction,
      jurisdictionLanguage,
      bridgeLanguage,
      uiLanguage,
      type,
      inputs,
      prisma,
    });
  } catch (e) {
    await logUsage({
      operation: "GENERATE",
      jurisdiction,
      languageEnum: isoToEnum(jurisdictionLanguage) ?? "EN",
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
      jurisdictionLanguage,
      bridgeLanguage,
      uiLanguage,
      type,
      metadata: docResult.document.metadata as unknown as Prisma.InputJsonValue,
      sections: docResult.document.sections as unknown as Prisma.InputJsonValue,
      // If the consumer passed an authenticated user id we record acceptance
      // immediately. Otherwise the dedicated PUT acceptance endpoint can
      // record it later when the user clicks the consent button.
      acceptedByUserId: acceptedByUserId ?? null,
      uiLanguageAcceptedAt: acceptedByUserId ? new Date() : null,
      userIpAddress: ip,
    },
    select: { id: true, createdAt: true },
  });

  await logUsage({
    operation: "GENERATE",
    jurisdiction,
    languageEnum: isoToEnum(jurisdictionLanguage) ?? "EN",
    type,
    sectionId: null,
    contractId: saved.id,
    usage: docResult.usage,
    status: "OK",
    error: null,
  });

  return NextResponse.json(
    {
      id: saved.id,
      createdAt: saved.createdAt,
      document: docResult.document,
      usage: {
        ...docResult.usage,
        costUsd: computeCostUsd(docResult.usage.inputTokens, docResult.usage.outputTokens),
      },
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/contract — partial section edit, regenerated in all 3 languages
// Body: { contractId, sectionId, userInstruction, acceptedByUserId? }
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

  let editResult;
  try {
    editResult = await editContractSection({
      jurisdiction: contract.jurisdiction,
      jurisdictionLanguage: contract.jurisdictionLanguage,
      bridgeLanguage: contract.bridgeLanguage,
      uiLanguage: contract.uiLanguage,
      type: contract.type,
      sectionId,
      current: {
        content_legal: target.content_legal,
        content_bridge: target.content_bridge,
        content_ui: target.content_ui,
      },
      userInstruction,
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

  // Editing a section invalidates a previously-recorded acceptance (the user
  // accepted a different version of the contract). Optionally re-stamp if the
  // caller forwarded a new userId — otherwise clear acceptance.
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

  return NextResponse.json({
    id: updated.id,
    updatedAt: updated.updatedAt,
    section: editResult.section,
    usage: {
      ...editResult.usage,
      costUsd: computeCostUsd(editResult.usage.inputTokens, editResult.usage.outputTokens),
    },
  });
}

// ---------------------------------------------------------------------------
// PUT /api/contract — record user acceptance (audit trail only)
// Body: { contractId, acceptedByUserId }
// IP is captured from request headers.
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
  // Ensure ContractSectionSchema reference is kept for tree-shaking
  void ContractSectionSchema;
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
