import "./http-runtime";

import { ChatOllama } from "@langchain/ollama";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import type { PrismaClient, ContractType, Language } from "@prisma/client";
import { z } from "zod";

import {
  ContractDocumentSchema,
  ContractSectionSchema,
  type ContractDocument,
  type ContractSection,
} from "./schemas";
import {
  SYSTEM_GENERATE,
  SYSTEM_EDIT,
  SYSTEM_EXTRACT,
  SYSTEM_EXTRACT_FACTS,
  SYSTEM_ROUTE_CHAT,
  buildGeneratePrompt,
  buildEditPrompt,
  buildExtractPrompt,
  buildExtractFactsPrompt,
  buildRouteChatPrompt,
  type ConstraintRow,
  type GlossaryRow,
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
// Public types
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
  section: ContractSection;
  usage: UsageInfo;
}

// ---------------------------------------------------------------------------
// Constraint / glossary / template loaders
// ---------------------------------------------------------------------------

/**
 * Map ISO 639-1 lowercase code -> our internal Language enum, where a match
 * exists. Used to scope LegalConstraint rows since that table still keys on
 * the enum.
 */
function isoToEnum(iso: string): Language | null {
  switch (iso.toLowerCase().split("-")[0]) {
    case "he": return "HE";
    case "en": return "EN";
    case "ru": return "RU";
    case "ar": return "AR";
    default:   return null;
  }
}

export async function fetchConstraints(
  prisma: PrismaClient,
  jurisdiction: string,
  type: ContractType,
  jurisdictionLanguage: string,
): Promise<ConstraintRow[]> {
  const langEnum = isoToEnum(jurisdictionLanguage);
  return prisma.legalConstraint.findMany({
    where: {
      isActive: true,
      jurisdiction,
      AND: [
        { OR: [{ type: null }, { type }] },
        langEnum ? { OR: [{ language: null }, { language: langEnum }] } : {},
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: { rule: true, citation: true, category: true },
  });
}

export async function fetchGlossary(
  prisma: PrismaClient,
  jurisdiction: string,
  languages: string[],
): Promise<GlossaryRow[]> {
  if (languages.length === 0) return [];
  return prisma.glossary.findMany({
    where: {
      isActive: true,
      jurisdiction,
      language: { in: languages },
    },
    orderBy: [{ term: "asc" }, { language: "asc" }],
    select: { term: true, language: true, rigidValue: true, notes: true },
  });
}

const TEMPLATE_INJECTION_COUNT = Number(process.env.TEMPLATE_INJECTION_COUNT ?? 3);

export async function fetchExemplarTemplates(
  prisma: PrismaClient,
  jurisdiction: string,
  type: ContractType,
  jurisdictionLanguage: string,
): Promise<TemplateRef[]> {
  const langEnum = isoToEnum(jurisdictionLanguage);
  // Templates are stored in our Language enum; if the requested
  // jurisdictionLanguage doesn't map to an enum value we can't filter by it.
  const all = await prisma.contractTemplate.findMany({
    where: {
      isActive: true,
      jurisdiction,
      type,
      ...(langEnum ? { language: langEnum } : {}),
    },
    orderBy: { priority: "desc" },
    select: { title: true, language: true, sections: true },
  });
  if (all.length === 0) return [];

  const picked =
    all.length <= TEMPLATE_INJECTION_COUNT
      ? all
      : sampleN(all, TEMPLATE_INJECTION_COUNT);

  return picked
    .map((row) => {
      const parsed = LegacySectionsSchema.safeParse(row.sections);
      if (!parsed.success) return null;
      return {
        title: row.title,
        language: row.language.toLowerCase(),
        sections: parsed.data,
      };
    })
    .filter((t): t is TemplateRef => t !== null);
}

const LegacySectionsSchema = z.array(
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    content: z.string().min(1),
  }),
);

function sampleN<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ---------------------------------------------------------------------------
// Generate — Holy Trinity output
// ---------------------------------------------------------------------------

export interface GenerateInput {
  jurisdiction: string;
  jurisdictionLanguage: string;
  bridgeLanguage: string;
  uiLanguage: string;
  type: ContractType;
  inputs: Record<string, unknown>;
  prisma: PrismaClient;
}

export async function generateInitialContract(
  input: GenerateInput,
): Promise<GenerationResult> {
  const [constraints, glossary, templates] = await Promise.all([
    fetchConstraints(input.prisma, input.jurisdiction, input.type, input.jurisdictionLanguage),
    fetchGlossary(input.prisma, input.jurisdiction, [
      input.jurisdictionLanguage,
      input.bridgeLanguage,
      input.uiLanguage,
    ]),
    fetchExemplarTemplates(input.prisma, input.jurisdiction, input.type, input.jurisdictionLanguage),
  ]);

  const userPrompt = buildGeneratePrompt({
    jurisdiction: input.jurisdiction,
    jurisdictionLanguage: input.jurisdictionLanguage,
    bridgeLanguage: input.bridgeLanguage,
    uiLanguage: input.uiLanguage,
    type: input.type,
    inputs: input.inputs,
    constraints,
    glossary,
    templates,
  });

  const startedAt = Date.now();
  const res = await jsonModel.invoke([
    new SystemMessage(SYSTEM_GENERATE),
    new HumanMessage(userPrompt),
  ]);
  const durationMs = Date.now() - startedAt;

  const raw = messageContentToString(res.content);
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Model returned non-JSON output: ${(e as Error).message}\n--- raw ---\n${raw.slice(0, 500)}`,
    );
  }

  // Force metadata coherence — model occasionally drifts on locale strings.
  if (parsed && typeof parsed === "object") {
    (parsed as Record<string, unknown>).metadata = {
      jurisdiction: input.jurisdiction,
      jurisdictionLanguage: input.jurisdictionLanguage,
      bridgeLanguage: input.bridgeLanguage,
      uiLanguage: input.uiLanguage,
      type: input.type,
    };
  }

  const validated = ContractDocumentSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Model output failed schema validation: ${validated.error.message}`,
    );
  }

  // Defensive: ensure language_waiver is the FINAL section. If the model
  // emitted it earlier, move it; if missing, fail loudly.
  const sections = [...validated.data.sections];
  const waiverIdx = sections.findIndex((s) => s.id === "language_waiver");
  if (waiverIdx === -1) {
    throw new Error("Model did not emit a language_waiver section");
  }
  if (waiverIdx !== sections.length - 1) {
    const [waiver] = sections.splice(waiverIdx, 1);
    sections.push(waiver);
  }

  return {
    document: { metadata: validated.data.metadata, sections },
    usage: extractUsage(res, durationMs),
  };
}

// ---------------------------------------------------------------------------
// Edit — single section, regenerated in all three languages
// ---------------------------------------------------------------------------

export interface EditInput {
  jurisdiction: string;
  jurisdictionLanguage: string;
  bridgeLanguage: string;
  uiLanguage: string;
  type: ContractType;
  sectionId: string;
  current: { content_legal: string; content_bridge: string; content_ui: string };
  userInstruction: string;
  prisma: PrismaClient;
}

export async function editContractSection(input: EditInput): Promise<EditResult> {
  const [constraints, glossary] = await Promise.all([
    fetchConstraints(input.prisma, input.jurisdiction, input.type, input.jurisdictionLanguage),
    fetchGlossary(input.prisma, input.jurisdiction, [
      input.jurisdictionLanguage,
      input.bridgeLanguage,
      input.uiLanguage,
    ]),
  ]);

  const userPrompt = buildEditPrompt({
    jurisdiction: input.jurisdiction,
    jurisdictionLanguage: input.jurisdictionLanguage,
    bridgeLanguage: input.bridgeLanguage,
    uiLanguage: input.uiLanguage,
    type: input.type,
    sectionId: input.sectionId,
    current: input.current,
    userInstruction: input.userInstruction,
    constraints,
    glossary,
  });

  const startedAt = Date.now();
  const res = await jsonModel.invoke([
    new SystemMessage(SYSTEM_EDIT),
    new HumanMessage(userPrompt),
  ]);
  const durationMs = Date.now() - startedAt;

  const raw = messageContentToString(res.content);
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Model returned non-JSON output: ${(e as Error).message}\n--- raw ---\n${raw.slice(0, 500)}`,
    );
  }

  // Force the id to match what the caller asked to edit; the model
  // occasionally rewrites it.
  if (parsed && typeof parsed === "object") {
    (parsed as Record<string, unknown>).id = input.sectionId;
  }

  const validated = ContractSectionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Edit output failed validation: ${validated.error.message}`,
    );
  }

  return {
    section: validated.data,
    usage: extractUsage(res, durationMs),
  };
}

// ---------------------------------------------------------------------------
// Extract — raw uploaded contract → legacy single-content sections
// (templates remain single-content; only generated contracts are 3-column)
// ---------------------------------------------------------------------------

export interface ExtractInput {
  jurisdiction: string;
  language: Language;
  type: ContractType;
  rawText: string;
}

const ExtractedDocSchema = z.object({
  metadata: z.object({
    jurisdiction: z.string(),
    language: z.string(),
    type: z.string(),
  }),
  sections: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      content: z.string().min(1),
    }),
  ).min(1),
});

export type ExtractedDocument = z.infer<typeof ExtractedDocSchema>;

export async function extractTemplate(input: ExtractInput): Promise<ExtractedDocument> {
  const userPrompt = buildExtractPrompt({
    jurisdiction: input.jurisdiction,
    language: input.language,
    type: input.type,
    rawText: input.rawText,
  });
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

  const validated = ExtractedDocSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Extractor output failed validation: ${validated.error.message}`);
  }
  return validated.data;
}

// ---------------------------------------------------------------------------
// Placeholder utilities
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\[\[([A-Z][A-Z0-9_]*)\]\]/g;

/** Find every distinct [[FIELD_NAME]] across all 3 columns of all sections. */
export function collectPlaceholders(
  sections: ContractSection[],
): string[] {
  const set = new Set<string>();
  for (const s of sections) {
    for (const col of [s.content_legal, s.content_bridge, s.content_ui]) {
      for (const m of col.matchAll(PLACEHOLDER_RE)) set.add(m[1]);
    }
  }
  return Array.from(set).sort();
}

/**
 * Apply a facts map by literal substitution of every [[KEY]] across all
 * 3 columns of every section. Returns the new sections array and the set
 * of fact keys that actually matched something. Unmatched keys are silently
 * ignored — the caller decides if that is an error.
 */
export function applyFactsToSections(
  sections: ContractSection[],
  facts: Record<string, string>,
): { sections: ContractSection[]; appliedKeys: string[] } {
  const applied = new Set<string>();
  const next = sections.map((s) => {
    const replaceIn = (text: string): string =>
      text.replace(PLACEHOLDER_RE, (whole, key: string) => {
        if (Object.prototype.hasOwnProperty.call(facts, key)) {
          applied.add(key);
          return facts[key];
        }
        return whole;
      });
    return {
      ...s,
      content_legal: replaceIn(s.content_legal),
      content_bridge: replaceIn(s.content_bridge),
      content_ui: replaceIn(s.content_ui),
    };
  });
  return { sections: next, appliedKeys: Array.from(applied).sort() };
}

// ---------------------------------------------------------------------------
// Fact extraction — natural-language instruction -> structured facts map
// ---------------------------------------------------------------------------

const FactsResponseSchema = z.object({
  facts: z.record(
    z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    z.string().min(1).max(2000),
  ),
});

export interface ExtractFactsResult {
  facts: Record<string, string>;
  usage: UsageInfo;
}

export async function extractFactsFromInstruction(
  instruction: string,
  knownFields: string[],
): Promise<ExtractFactsResult> {
  const prompt = buildExtractFactsPrompt({ instruction, knownFields });
  const startedAt = Date.now();
  const res = await jsonModel.invoke([
    new SystemMessage(SYSTEM_EXTRACT_FACTS),
    new HumanMessage(prompt),
  ]);
  const durationMs = Date.now() - startedAt;
  const raw = messageContentToString(res.content);
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Fact extractor returned non-JSON: ${(e as Error).message}\n--- raw ---\n${raw.slice(0, 300)}`,
    );
  }
  const validated = FactsResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Fact extractor failed validation: ${validated.error.message}`);
  }
  return { facts: validated.data.facts, usage: extractUsage(res, durationMs) };
}

// ---------------------------------------------------------------------------
// Chat routing — classify a user turn as chat vs generate-contract
// ---------------------------------------------------------------------------

const RouteResponseSchema = z.object({
  intent: z.enum(["chat", "generate_contract"]),
  generate: z
    .object({
      jurisdiction: z.string().min(2),
      jurisdiction_language: z.string().min(2),
      bridge_language: z.string().min(2),
      ui_language: z.string().min(2),
      type: z.enum(["ANNUAL", "SUBLET", "MANAGEMENT"]),
      inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .optional(),
});

export type RouteDecision =
  | { intent: "chat"; usage: UsageInfo }
  | {
      intent: "generate_contract";
      params: {
        jurisdiction: string;
        jurisdictionLanguage: string;
        bridgeLanguage: string;
        uiLanguage: string;
        type: ContractType;
        inputs: Record<string, unknown>;
      };
      usage: UsageInfo;
    };

export async function routeChatTurn(
  message: string,
  uiLanguageHint: string,
): Promise<RouteDecision> {
  const prompt = buildRouteChatPrompt({ message, uiLanguageHint });
  const startedAt = Date.now();
  const res = await jsonModel.invoke([
    new SystemMessage(SYSTEM_ROUTE_CHAT),
    new HumanMessage(prompt),
  ]);
  const durationMs = Date.now() - startedAt;
  const raw = messageContentToString(res.content);
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Routing failure -> fall back to chat
    return { intent: "chat", usage: extractUsage(res, durationMs) };
  }

  const validated = RouteResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return { intent: "chat", usage: extractUsage(res, durationMs) };
  }

  if (validated.data.intent === "chat" || !validated.data.generate) {
    return { intent: "chat", usage: extractUsage(res, durationMs) };
  }

  const g = validated.data.generate;
  const inputs: Record<string, unknown> = {};
  if (g.inputs) for (const [k, v] of Object.entries(g.inputs)) inputs[k] = v;

  return {
    intent: "generate_contract",
    params: {
      jurisdiction: g.jurisdiction,
      jurisdictionLanguage: g.jurisdiction_language.toLowerCase(),
      bridgeLanguage: g.bridge_language.toLowerCase(),
      uiLanguage: g.ui_language.toLowerCase(),
      type: g.type as ContractType,
      inputs,
    },
    usage: extractUsage(res, durationMs),
  };
}

// ---------------------------------------------------------------------------
// Chat (free-form Q&A) — unchanged
// ---------------------------------------------------------------------------

const SYSTEM_CHAT = `You are MyHome's real-estate assistant.
You help landlords, tenants, and managers understand rental contracts, jurisdiction-specific rules, and lease terms.
Keep answers concise, practical, and jurisdiction-aware.
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
  if (history.length === 0) throw new Error("chat history is empty");
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
  out = out.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
  out = out.replace(/\n?```\s*$/, "");
  const firstBrace = out.search(/[{[]/);
  if (firstBrace > 0) out = out.slice(firstBrace);
  const lastBrace = Math.max(out.lastIndexOf("}"), out.lastIndexOf("]"));
  if (lastBrace >= 0 && lastBrace < out.length - 1) out = out.slice(0, lastBrace + 1);
  return out.trim();
}
