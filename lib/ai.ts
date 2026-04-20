import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AIMessage, MessageContent } from "@langchain/core/messages";
import type { PrismaClient, ContractType, Language } from "@prisma/client";

import {
  ContractDocumentSchema,
  type ContractDocument,
} from "./schemas";
import {
  SYSTEM_GENERATE,
  SYSTEM_EDIT,
  buildGeneratePrompt,
  buildEditPrompt,
  type ConstraintRow,
} from "./prompts";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4";

const jsonModel = new ChatOllama({
  baseUrl: OLLAMA_URL,
  model: OLLAMA_MODEL,
  temperature: 0.2,
  format: "json",
});

const textModel = new ChatOllama({
  baseUrl: OLLAMA_URL,
  model: OLLAMA_MODEL,
  temperature: 0.15,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
}

export interface GenerationResult {
  document: ContractDocument;
  usage: UsageInfo;
}

export interface EditResult {
  content: string;
  usage: UsageInfo;
}

// ---------------------------------------------------------------------------
// Constraint loader
// ---------------------------------------------------------------------------

export async function fetchConstraints(
  prisma: PrismaClient,
  jurisdiction: string,
  type: ContractType,
  language: Language,
): Promise<ConstraintRow[]> {
  return prisma.legalConstraint.findMany({
    where: {
      isActive: true,
      jurisdiction,
      AND: [
        { OR: [{ type: null }, { type }] },
        { OR: [{ language: null }, { language }] },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: { rule: true, citation: true, category: true },
  });
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export interface GenerateInput {
  jurisdiction: string;
  language: Language;
  type: ContractType;
  inputs: Record<string, unknown>;
  prisma: PrismaClient;
}

export async function generateInitialContract(
  input: GenerateInput,
): Promise<GenerationResult> {
  const constraints = await fetchConstraints(
    input.prisma,
    input.jurisdiction,
    input.type,
    input.language,
  );

  const userPrompt = buildGeneratePrompt({
    jurisdiction: input.jurisdiction,
    language: input.language,
    type: input.type,
    inputs: input.inputs,
    constraints,
  });

  const startedAt = Date.now();
  const res = await jsonModel.invoke([
    new SystemMessage(SYSTEM_GENERATE),
    new HumanMessage(userPrompt),
  ]);
  const durationMs = Date.now() - startedAt;

  const raw = messageContentToString(res.content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Model returned non-JSON output: ${(e as Error).message}\n--- raw ---\n${raw}`,
    );
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "metadata" in parsed &&
    typeof (parsed as { metadata: unknown }).metadata === "object"
  ) {
    (parsed as { metadata: Record<string, unknown> }).metadata = {
      ...(parsed as { metadata: Record<string, unknown> }).metadata,
      jurisdiction: input.jurisdiction,
      language: input.language,
      type: input.type,
    };
  }

  const validated = ContractDocumentSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Model output failed schema validation: ${validated.error.message}`,
    );
  }

  return {
    document: validated.data,
    usage: extractUsage(res, durationMs),
  };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export interface EditInput {
  jurisdiction: string;
  language: Language;
  type: ContractType;
  sectionTitle: string;
  currentSectionContent: string;
  userInstruction: string;
  prisma: PrismaClient;
}

export async function editContractSection(input: EditInput): Promise<EditResult> {
  const constraints = await fetchConstraints(
    input.prisma,
    input.jurisdiction,
    input.type,
    input.language,
  );

  const userPrompt = buildEditPrompt({
    language: input.language,
    jurisdiction: input.jurisdiction,
    sectionTitle: input.sectionTitle,
    currentSectionContent: input.currentSectionContent,
    userInstruction: input.userInstruction,
    constraints,
  });

  const startedAt = Date.now();
  const res = await textModel.invoke([
    new SystemMessage(SYSTEM_EDIT),
    new HumanMessage(userPrompt),
  ]);
  const durationMs = Date.now() - startedAt;

  const raw = messageContentToString(res.content);
  const cleaned = sanitizeEditOutput(raw);

  if (cleaned.length === 0) {
    throw new Error("Model produced an empty section after sanitization");
  }

  return {
    content: cleaned,
    usage: extractUsage(res, durationMs),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function messageContentToString(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((c) => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object" && "text" in c && typeof c.text === "string") {
        return c.text;
      }
      return "";
    })
    .join("");
}

interface UsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface ResponseMetadata {
  prompt_eval_count?: number;
  eval_count?: number;
  model?: string;
}

function extractUsage(res: AIMessage, durationMs: number): UsageInfo {
  const um = (res as AIMessage & { usage_metadata?: UsageMetadata }).usage_metadata;
  const meta = (res as AIMessage & { response_metadata?: ResponseMetadata }).response_metadata;

  const input = um?.input_tokens ?? meta?.prompt_eval_count ?? 0;
  const output = um?.output_tokens ?? meta?.eval_count ?? 0;
  const total = um?.total_tokens ?? input + output;

  return {
    model: meta?.model ?? OLLAMA_MODEL,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    durationMs,
  };
}

function sanitizeEditOutput(text: string): string {
  let out = text.trim();
  out = out.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  out = out.replace(/\n?```\s*$/, "");
  out = out.replace(/^"""\s*/, "").replace(/\s*"""$/, "");

  const chattyHeads: RegExp[] = [
    /^here(?:'s| is)\s+the\s+(?:revised|updated|new)[^:\n]*:\s*/i,
    /^(?:revised|updated|new)\s+clause\s*[:\-]\s*/i,
    /^sure[,!.\s]+/i,
    /^certainly[,!.\s]+/i,
    /^okay[,!.\s]+/i,
  ];
  for (const re of chattyHeads) out = out.replace(re, "");

  return out.trim();
}
