import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  GenerateRequestSchema,
  EditRequestSchema,
  ContractDocumentSchema,
  type ContractDocument,
  type ContractSection,
} from "@/lib/schemas";
import {
  generateInitialContract,
  editContractSection,
} from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/contract — initial generation
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

  let doc: ContractDocument;
  try {
    doc = await generateInitialContract({
      jurisdiction,
      language,
      type,
      inputs,
      prisma,
    });
  } catch (e) {
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
      metadata: doc.metadata as unknown as Prisma.InputJsonValue,
      sections: doc.sections as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json(
    { id: saved.id, createdAt: saved.createdAt, document: doc },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/contract — partial section edit
// Body: { contractId, sectionId, userInstruction }
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

  let newContent: string;
  try {
    newContent = await editContractSection({
      jurisdiction: contract.jurisdiction,
      language: contract.language,
      type: contract.type,
      sectionTitle: target.title,
      currentSectionContent: target.content,
      userInstruction,
      prisma,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Edit failed", detail: (e as Error).message },
      { status: 502 },
    );
  }

  const updatedSections: ContractSection[] = sections.map((s) =>
    s.id === sectionId ? { ...s, content: newContent } : s,
  );

  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: {
      sections: updatedSections as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, updatedAt: true },
  });

  return NextResponse.json({
    id: updated.id,
    updatedAt: updated.updatedAt,
    section: { id: sectionId, title: target.title, content: newContent },
  });
}
