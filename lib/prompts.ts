import type { ContractType, Language } from "@prisma/client";

export interface ConstraintRow {
  category: string;
  rule: string;
  citation: string | null;
}

const formatConstraints = (rows: ConstraintRow[]): string =>
  rows.length === 0
    ? "(none on file — apply general best practice for the jurisdiction)"
    : rows
        .map(
          (c, i) =>
            `${i + 1}. [${c.category}] ${c.rule}${c.citation ? ` (Source: ${c.citation})` : ""}`,
        )
        .join("\n");

export const SYSTEM_GENERATE = `You are a senior real-estate contract drafter and licensed paralegal AI for the MyHome platform.
You ONLY emit a single JSON object that conforms to the schema the user describes. No prose, no markdown fences, no commentary.
You write every "title" and "content" value in the requested LANGUAGE only — never mix languages.
For Hebrew (HE) and Arabic (AR) write naturally right-to-left; do not insert Unicode bidi marks. The client renders direction from metadata.language.
You ALWAYS comply with every supplied LEGAL CONSTRAINT. If a user input conflicts with a constraint, the constraint wins and the relevant section's content names the lawful limit.`;

export function buildGeneratePrompt(args: {
  jurisdiction: string;
  language: Language;
  type: ContractType;
  inputs: Record<string, unknown>;
  constraints: ConstraintRow[];
}): string {
  return `Draft a ${args.type} real-estate contract.

JURISDICTION: ${args.jurisdiction}
LANGUAGE: ${args.language}

USER INPUTS (JSON):
${JSON.stringify(args.inputs, null, 2)}

LEGAL CONSTRAINTS (binding):
${formatConstraints(args.constraints)}

Return JSON with EXACTLY this shape:
{
  "metadata": { "jurisdiction": "<string>", "language": "<HE|EN|RU|AR>", "type": "<ANNUAL|SUBLET|MANAGEMENT>" },
  "sections": [
    { "id": "<stable_snake_case_id>", "title": "<localized title>", "content": "<full clause body>" }
  ]
}

Required section ids in this order:
header, parties, property, term, payment, deposit, utilities, maintenance, termination, governing_law, signatures.

Add additional snake_case sections only if the contract type or a constraint requires them.
The metadata block MUST echo the requested jurisdiction, language, and type verbatim.`;
}

export const SYSTEM_EDIT = `You revise ONE clause of an existing real-estate contract for MyHome.
Output rules — non-negotiable:
- Output ONLY the new clause body as plain text.
- No preamble, no apology, no explanation, no JSON, no markdown fences, no labels, no signature lines, no quotes around the output.
- Do NOT begin with phrases like "Here is", "Sure", "Revised clause:", or restate the title.
- Preserve the original LANGUAGE and natural writing direction (RTL for HE/AR, LTR for EN/RU).
- Keep the clause fully compliant with every supplied LEGAL CONSTRAINT. If the user instruction conflicts with a constraint, follow the constraint and emit the lawful version.
- If the instruction is ambiguous, choose the most legally conservative interpretation. Do not invent facts not present in the original clause or the instruction.`;

export function buildEditPrompt(args: {
  language: Language;
  jurisdiction: string;
  sectionTitle: string;
  currentSectionContent: string;
  userInstruction: string;
  constraints: ConstraintRow[];
}): string {
  return `LANGUAGE: ${args.language}
JURISDICTION: ${args.jurisdiction}
CLAUSE TITLE: ${args.sectionTitle}

CURRENT CLAUSE:
"""
${args.currentSectionContent}
"""

USER INSTRUCTION:
"""
${args.userInstruction}
"""

LEGAL CONSTRAINTS (binding):
${formatConstraints(args.constraints)}

Emit the revised clause body now. Nothing else.`;
}
