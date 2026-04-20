import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  GenerateRequestSchema,
  EditRequestSchema,
  ContractDocumentSchema,
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
      language: true,
      type: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ contracts });
}

// ---------------------------------------------------------------------------
// POST — initial generation
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
  const { jurisdiction, language, type, inputs } = parsed.data;

  let docResult;
  try {
    docResult = await generateInitialContract({
      jurisdiction,
      language,
      type,
      inputs,
      prisma,
    });
  } catch (e) {
    await logUsage({
      operation: "GENERATE",
      jurisdiction,
      language,
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
      language,
      type,
      metadata: docResult.document.metadata as unknown as Prisma.InputJsonValue,
      sections: docResult.document.sections as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });

  await logUsage({
    operation: "GENERATE",
    jurisdiction,
    language,
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
      usage: { ...docResult.usage, costUsd: computeCostUsd(docResult.usage.inputTokens, docResult.usage.outputTokens) },
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// PATCH — partial section edit
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
  const { contractId, sectionId, userInstruction } = parsed.data;

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
  });
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
  const target = sections.find((s) => s.id === sectionId);
  if (!target) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  let editResult;
  try {
    editResult = await editContractSection({
      jurisdiction: contract.jurisdiction,
      language: contract.language,
      type: contract.type,
      sectionTitle: target.title,
      currentSectionContent: target.content,
      userInstruction,
      prisma,
    });
  } catch (e) {
    await logUsage({
      operation: "EDIT",
      jurisdiction: contract.jurisdiction,
      language: contract.language,
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
    s.id === sectionId ? { ...s, content: editResult.content } : s,
  );

  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: {
      sections: updatedSections as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, updatedAt: true },
  });

  await logUsage({
    operation: "EDIT",
    jurisdiction: contract.jurisdiction,
    language: contract.language,
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
    section: { id: sectionId, title: target.title, content: editResult.content },
    usage: { ...editResult.usage, costUsd: computeCostUsd(editResult.usage.inputTokens, editResult.usage.outputTokens) },
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

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
  language: "HE" | "EN" | "RU" | "AR";
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
        language: args.language,
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
    // logging is best-effort; never fail the user request because the log failed
  }
}
