/**
 * Canonical template path — fast, deterministic contract assembly.
 *
 * If a lawyer-curated CANONICAL template exists for a (jurisdiction, type,
 * language) combo, the API uses it directly: substitute [[PLACEHOLDERS]]
 * from the deal context, return as a generated document. No LLM call for
 * the body — translation can still happen lazily afterward.
 *
 * If no canonical template exists, the caller falls back to the regular
 * LLM generation path.
 */

import type { PrismaClient, ContractType } from "@prisma/client";
import { z } from "zod";

import { applyFactsToSections, type UsageInfo } from "./ai";
import type { ContractDocument, ContractSection } from "./schemas";

// The shape we accept from CANONICAL templates is the legacy single-content
// section schema. We map it to the runtime 3-column ContractSection shape.
const TemplateSectionSchema = z.array(
  z.object({
    id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
    title: z.string().min(1).optional(), // title is informational; not stored
    content: z.string().min(1),
  }),
);

function isoToEnum(iso: string): "HE" | "EN" | "RU" | "AR" | null {
  switch (iso.toLowerCase().split("-")[0]) {
    case "he": return "HE";
    case "en": return "EN";
    case "ru": return "RU";
    case "ar": return "AR";
    default:   return null;
  }
}

export interface CanonicalLookup {
  jurisdiction: string;
  type: ContractType;
  jurisdictionLanguage: string;
}

export async function findCanonicalTemplate(
  prisma: PrismaClient,
  q: CanonicalLookup,
): Promise<{ id: string; title: string; sections: ContractSection[] } | null> {
  const langEnum = isoToEnum(q.jurisdictionLanguage);
  if (!langEnum) return null; // canonical templates currently key on the Language enum

  const row = await prisma.contractTemplate.findFirst({
    where: {
      isActive: true,
      kind: "CANONICAL",
      jurisdiction: q.jurisdiction,
      type: q.type,
      language: langEnum,
    },
    orderBy: { priority: "desc" },
    select: { id: true, title: true, sections: true },
  });
  if (!row) return null;

  const parsed = TemplateSectionSchema.safeParse(row.sections);
  if (!parsed.success) return null;

  // Map { id, content } -> ContractSection (with empty bridge/ui).
  const sections: ContractSection[] = parsed.data.map((s) => ({
    id: s.id,
    content_legal: s.content,
    content_bridge: "",
    content_ui: "",
  }));
  return { id: row.id, title: row.title, sections };
}

export interface CanonicalAssembleArgs {
  template: { id: string; title: string; sections: ContractSection[] };
  jurisdiction: string;
  jurisdictionLanguage: string;
  type: ContractType;
  /** Free-form facts from the API request body. Merged with the deal
   *  context's structured key/value when available. */
  inputs: Record<string, unknown>;
  /** Fact Sheet from lib/context-builder. The substitution layer doesn't
   *  consume it directly (it works on a flat key/value map), but we use it
   *  to derive structured facts when possible. Caller should pass `facts`
   *  separately if available. */
  facts?: Record<string, string>;
}

export interface CanonicalAssembleResult {
  document: ContractDocument;
  usage: UsageInfo;
  templateId: string;
  appliedFacts: string[];
  remainingPlaceholders: string[];
}

/**
 * Assemble a contract from a canonical template + facts. No LLM call.
 *
 * Returns a doc shaped exactly like the LLM path's GenerationResult so the
 * route handler can persist + respond uniformly.
 */
export function assembleFromCanonical(
  args: CanonicalAssembleArgs,
): CanonicalAssembleResult {
  const startedAt = Date.now();

  const facts = args.facts ?? {};
  // Allow inputs to fill placeholders too (string values only).
  for (const [k, v] of Object.entries(args.inputs)) {
    if (typeof v === "string" && /^[A-Z][A-Z0-9_]*$/.test(k) && !facts[k]) {
      facts[k] = v;
    }
  }

  const { sections, appliedKeys } = applyFactsToSections(args.template.sections, facts);

  const remaining = collectPlaceholdersInSections(sections);

  const document: ContractDocument = {
    metadata: {
      jurisdiction: args.jurisdiction,
      jurisdictionLanguage: args.jurisdictionLanguage,
      type: args.type,
    },
    sections,
  };

  return {
    document,
    usage: {
      model: "canonical-template",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: Date.now() - startedAt,
    },
    templateId: args.template.id,
    appliedFacts: appliedKeys,
    remainingPlaceholders: remaining,
  };
}

const PLACEHOLDER_RE = /\[\[([A-Z][A-Z0-9_]*)\]\]/g;

function collectPlaceholdersInSections(sections: ContractSection[]): string[] {
  const set = new Set<string>();
  for (const s of sections) {
    for (const col of [s.content_legal, s.content_bridge, s.content_ui]) {
      for (const m of col.matchAll(PLACEHOLDER_RE)) set.add(m[1]);
    }
  }
  return Array.from(set).sort();
}
