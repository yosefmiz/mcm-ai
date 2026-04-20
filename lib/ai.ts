import { ChatOllama } from "@langchain/ollama";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import type { PrismaClient, ContractType, Language } from "@prisma/client";

import {
  ContractDocumentSchema,
  type ContractDocument,
} from "./schemas";
import {
  SYSTEM_GENERATE,
  SYSTEM_EDIT,
  SYSTEM_EXTRACT,
  buildGeneratePrompt,
  buildEditPrompt,
  buildExtractPrompt,
  type ConstraintRow,
  type TemplateRef,
} from "./prompts";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4";
const OLLAMA_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 16384);

const jsonModel = new ChatOllama({
  baseUrl: OLLAMA_URL,
  model: OLLAMA_MODEL,
  temperature: 0.2,
  format: "json",
  numCtx: OLLAMA_CTX,
});

const textModel = new ChatOllama({
  baseUrl: OLLAMA_URL,
  model: OLLAMA_MODEL,
  temperature: 0.15,
  numCtx: OLLAMA_CTX,
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
  const [constraints, templates] = await Promise.all([
    fetchConstraints(input.prisma, input.jurisdiction, input.type, input.language),
    fetchExemplarTemplates(input.prisma, input.jurisdiction, input.type, input.language),
  ]);

  const userPrompt = buildGeneratePrompt({
    jurisdiction: input.jurisdiction,
    language: input.language,
    type: input.type,
    inputs: input.inputs,
    constraints,
    templates,
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
// Template extraction (raw text → structured ContractDocument)
// ---------------------------------------------------------------------------

export interface ExtractInput {
  jurisdiction: string;
  language: Language;
  type: ContractType;
  rawText: string;
}

export async function extractTemplate(input: ExtractInput): Promise<ContractDocument> {
  const userPrompt = buildExtractPrompt(input);
  const res = await jsonModel.invoke([
    new SystemMessage(SYSTEM_EXTRACT),
    new HumanMessage(userPrompt),
  ]);
  const raw = messageContentToString(res.content);
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Extractor returned non-JSON: ${(e as Error).message}\n--- raw ---\n${raw.slice(0, 500)}`,
    );
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    obj.metadata = {
      jurisdiction: input.jurisdiction,
      language: input.language,
      type: input.type,
    };

    // Drop incomplete sections — extractor sometimes emits stubs with empty
    // content for headings it couldn't fill. Validating those would fail the
    // whole document; pruning them lets imperfect extractions still land.
    if (Array.isArray(obj.sections)) {
      obj.sections = obj.sections.filter((s) => {
        if (!s || typeof s !== "object") return false;
        const sec = s as Record<string, unknown>;
        return (
          typeof sec.id === "string" &&
          sec.id.length > 0 &&
          typeof sec.title === "string" &&
          sec.title.length > 0 &&
          typeof sec.content === "string" &&
          sec.content.trim().length > 0
        );
      });
    }
  }

  const validated = ContractDocumentSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Extractor output failed validation: ${validated.error.message}`,
    );
  }
  return validated.data;
}

// ---------------------------------------------------------------------------
// Exemplar template loader (random sample for prompt injection)
// ---------------------------------------------------------------------------

const TEMPLATE_INJECTION_COUNT = Number(process.env.TEMPLATE_INJECTION_COUNT ?? 3);

export async function fetchExemplarTemplates(
  prisma: PrismaClient,
  jurisdiction: string,
  type: ContractType,
  language: Language,
): Promise<TemplateRef[]> {
  const all = await prisma.contractTemplate.findMany({
    where: { isActive: true, jurisdiction, type, language },
    orderBy: { priority: "desc" },
    select: { title: true, sections: true },
  });
  if (all.length === 0) return [];

  const picked = all.length <= TEMPLATE_INJECTION_COUNT
    ? all
    : sampleN(all, TEMPLATE_INJECTION_COUNT);

  return picked
    .map((row) => {
      const parsed = ContractDocumentSchema.shape.sections.safeParse(row.sections);
      if (!parsed.success) return null;
      return { title: row.title, sections: parsed.data };
    })
    .filter((t): t is TemplateRef => t !== null);
}

function sampleN<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ---------------------------------------------------------------------------
// Chat (free-form Q&A about real estate / contracts)
// ---------------------------------------------------------------------------

const SYSTEM_CHAT = `You are MyHome's real-estate assistant.
You help landlords, tenants, and managers understand rental contracts, jurisdiction-specific rules, and lease terms.
Keep answers concise, practical, and jurisdiction-aware. If the user asks for a contract, suggest they use the Playground page (/playground) and outline what info they need to provide.
Never invent statutes; if you are not sure of a specific rule, say so and suggest checking with a licensed attorney.
Match the user's language (Hebrew, English, Russian, Arabic).`;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  reply: string;
  usage: UsageInfo;
}

export async function chatComplete(history: ChatTurn[]): Promise<ChatResult> {
  if (history.length === 0) {
    throw new Error("chat history is empty");
  }
  const messages: BaseMessage[] = [new SystemMessage(SYSTEM_CHAT)];
  for (const turn of history) {
    messages.push(
      turn.role === "user"
        ? new HumanMessage(turn.content)
        : new AIMessage(turn.content),
    );
  }

  const startedAt = Date.now();
  const res = await textModel.invoke(messages);
  const durationMs = Date.now() - startedAt;

  const reply = messageContentToString(res.content).trim();
  if (!reply) throw new Error("Model produced an empty reply");

  return { reply, usage: extractUsage(res, durationMs) };
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

function stripJsonFences(text: string): string {
  let out = text.trim();
  // strip ```json or ``` opening fence
  out = out.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  out = out.replace(/\n?```\s*$/, "");
  // if model added a leading prose line before the JSON, find first { or [
  const firstBrace = out.search(/[{[]/);
  if (firstBrace > 0) out = out.slice(firstBrace);
  // trim trailing prose after the last closing brace
  const lastBrace = Math.max(out.lastIndexOf("}"), out.lastIndexOf("]"));
  if (lastBrace >= 0 && lastBrace < out.length - 1) out = out.slice(0, lastBrace + 1);
  return out.trim();
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
