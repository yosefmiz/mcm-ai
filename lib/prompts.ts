import type { ContractType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export interface ConstraintRow {
  category: string;
  rule: string;
  citation: string | null;
}

export interface GlossaryRow {
  term: string;
  language: string;
  rigidValue: string;
  notes: string | null;
}

// Templates use the legacy single-content section schema. They are reference
// exemplars; the model uses them for structural anchoring of the
// jurisdictionLanguage column.
export interface TemplateRef {
  title: string;
  language: string; // ISO-ish code or our enum value
  sections: { id: string; title: string; content: string }[];
}

const escapeXmlBody = (s: string): string =>
  s.replace(/]]>/g, "]]]]><![CDATA[>");

const cdata = (s: string): string => `<![CDATA[${escapeXmlBody(s)}]]>`;

const formatConstraints = (rows: ConstraintRow[]): string =>
  rows.length === 0
    ? "(none on file — apply general best practice for the jurisdiction)"
    : rows
        .map(
          (c, i) =>
            `${i + 1}. [${c.category}] ${c.rule}${c.citation ? ` (Source: ${c.citation})` : ""}`,
        )
        .join("\n");

const formatGlossary = (rows: GlossaryRow[]): string =>
  rows.length === 0
    ? "(none on file)"
    : rows
        .map(
          (g) =>
            `- term="${g.term}" language="${g.language}" required_wording="${g.rigidValue}"${g.notes ? ` notes="${g.notes}"` : ""}`,
        )
        .join("\n");

const formatTemplates = (refs: TemplateRef[]): string =>
  refs.length === 0
    ? "(none on file)"
    : refs
        .map(
          (ref, i) =>
            `--- REFERENCE ${i + 1} (language=${ref.language}) — ${ref.title} ---\n` +
            ref.sections
              .map((s) => `[${s.id}] ${s.title}\n${s.content}`)
              .join("\n\n"),
        )
        .join("\n\n");

// ===========================================================================
// GENERATE — full contract authoring (3-language native composition)
// ===========================================================================

export const SYSTEM_GENERATE = `<role>
You are MyHome's senior real-estate contract drafter and licensed paralegal AI.
You author contracts NATIVELY in three languages simultaneously. You never
machine-translate; each column is composed in its own native legal style.
</role>

<output_rules>
- Emit EXACTLY ONE valid JSON object that matches <output_schema>.
- No prose, no markdown fences, no commentary, no apology, no preamble.
- Every section MUST contain content_legal, content_bridge, and content_ui.
- content_legal is composed in the jurisdiction_language using its native
  legal register and standard local boilerplate.
- content_bridge is composed in the bridge_language using its native legal
  register — NOT a literal translation of content_legal.
- content_ui is composed in the ui_language as a clean, plain reader-friendly
  rendering of the same clause.
- Hebrew (he) and Arabic (ar) are written naturally right-to-left without
  any inserted Unicode bidi marks; clients render direction from metadata.
- Honor every <legal_constraint> with absolute priority. If a user input
  conflicts with a constraint, the constraint wins and the relevant section's
  content names the lawful limit.
- Use any <glossary> entry's required_wording verbatim wherever the
  underlying concept appears in the matching language column.
- Use <reference_templates> for structural anchoring and tone, NEVER copy
  verbatim. Adapt to the user's specifics.
- The FINAL section MUST be id="language_waiver" — see
  <language_waiver_requirements>.
</output_rules>`;

export interface BuildGenerateArgs {
  jurisdiction: string;
  jurisdictionLanguage: string;
  bridgeLanguage: string;
  uiLanguage: string;
  type: ContractType;
  inputs: Record<string, unknown>;
  constraints: ConstraintRow[];
  glossary: GlossaryRow[];
  templates: TemplateRef[];
}

export function buildGeneratePrompt(args: BuildGenerateArgs): string {
  return `<task>generate_contract</task>

<jurisdiction>${args.jurisdiction}</jurisdiction>
<contract_type>${args.type}</contract_type>
<jurisdiction_language>${args.jurisdictionLanguage}</jurisdiction_language>
<bridge_language>${args.bridgeLanguage}</bridge_language>
<ui_language>${args.uiLanguage}</ui_language>

<inputs>
${cdata(JSON.stringify(args.inputs, null, 2))}
</inputs>

<legal_constraints>
${cdata(formatConstraints(args.constraints))}
</legal_constraints>

<glossary>
${cdata(formatGlossary(args.glossary))}
</glossary>

<reference_templates>
${cdata(formatTemplates(args.templates))}
</reference_templates>

<required_section_ids>
header, parties, property, term, payment, deposit, utilities, maintenance, termination, governing_law, signatures, language_waiver
</required_section_ids>
<additional_sections_allowed>
Add additional snake_case sections only if the contract type or a constraint requires them (e.g. "guarantor", "indexation", "early_termination").
</additional_sections_allowed>

<language_waiver_requirements>
The FINAL section MUST be id="language_waiver".
- content_legal (in ${args.jurisdictionLanguage}) and content_bridge (in ${args.bridgeLanguage}) MUST explicitly state, in their respective native legal registers:
  1. The parties have read and understood this agreement.
  2. They voluntarily waive the right to a sworn translator.
  3. They acknowledge that the ${args.jurisdictionLanguage} version GOVERNS in case of any dispute.
  4. The ${args.bridgeLanguage} version is provided for the parties' mutual convenience and has no independent legal force.
- content_ui (in ${args.uiLanguage}) repeats the same substance in plain reader language.
</language_waiver_requirements>

<output_schema>
{
  "metadata": {
    "jurisdiction": "${args.jurisdiction}",
    "jurisdictionLanguage": "${args.jurisdictionLanguage}",
    "bridgeLanguage": "${args.bridgeLanguage}",
    "uiLanguage": "${args.uiLanguage}",
    "type": "${args.type}"
  },
  "sections": [
    {
      "id": "<snake_case_id>",
      "content_legal": "<full clause body in ${args.jurisdictionLanguage}>",
      "content_bridge": "<full clause body in ${args.bridgeLanguage}>",
      "content_ui": "<plain clause body in ${args.uiLanguage}>"
    }
  ]
}
</output_schema>

Emit the JSON now.`;
}

// ===========================================================================
// EDIT — single-section partial update with 3-language regeneration
// ===========================================================================

export const SYSTEM_EDIT = `<role>
You revise ONE clause of an existing real-estate contract for MyHome.
You regenerate the clause in all three languages simultaneously.
</role>

<output_rules>
- Emit EXACTLY ONE valid JSON object: { "id", "content_legal", "content_bridge", "content_ui" }.
- No prose, no markdown fences, no commentary, no preamble like "Here is".
- Preserve the section's id verbatim from <section_id>.
- Compose each language column natively, NOT by translating another column.
- Honor every <legal_constraint>. If the <user_instruction> conflicts with a
  constraint, follow the constraint and emit the lawful version. Do not
  apologize — silently produce the compliant clause.
- Use <glossary> required_wording verbatim wherever the concept appears in
  the matching language column.
- The <user_instruction> may be written in any language (often the
  ui_language). Understand its intent and apply it consistently across all
  three columns.
- Hebrew/Arabic are written right-to-left without bidi marks.
- Do not invent facts not present in the current clause or the instruction.
</output_rules>`;

export interface BuildEditArgs {
  jurisdiction: string;
  jurisdictionLanguage: string;
  bridgeLanguage: string;
  uiLanguage: string;
  type: ContractType;
  sectionId: string;
  current: { content_legal: string; content_bridge: string; content_ui: string };
  userInstruction: string;
  constraints: ConstraintRow[];
  glossary: GlossaryRow[];
}

export function buildEditPrompt(args: BuildEditArgs): string {
  return `<task>edit_section</task>

<jurisdiction>${args.jurisdiction}</jurisdiction>
<contract_type>${args.type}</contract_type>
<jurisdiction_language>${args.jurisdictionLanguage}</jurisdiction_language>
<bridge_language>${args.bridgeLanguage}</bridge_language>
<ui_language>${args.uiLanguage}</ui_language>

<section_id>${args.sectionId}</section_id>

<current_clause>
  <content_legal language="${args.jurisdictionLanguage}">
${cdata(args.current.content_legal)}
  </content_legal>
  <content_bridge language="${args.bridgeLanguage}">
${cdata(args.current.content_bridge)}
  </content_bridge>
  <content_ui language="${args.uiLanguage}">
${cdata(args.current.content_ui)}
  </content_ui>
</current_clause>

<user_instruction>
${cdata(args.userInstruction)}
</user_instruction>

<legal_constraints>
${cdata(formatConstraints(args.constraints))}
</legal_constraints>

<glossary>
${cdata(formatGlossary(args.glossary))}
</glossary>

<output_schema>
{
  "id": "${args.sectionId}",
  "content_legal": "<revised clause body in ${args.jurisdictionLanguage}>",
  "content_bridge": "<revised clause body in ${args.bridgeLanguage}>",
  "content_ui": "<revised clause body in ${args.uiLanguage}>"
}
</output_schema>

Emit the JSON now.`;
}

// ===========================================================================
// EXTRACT — raw uploaded contract → structured single-content sections.
// (Templates remain single-content; only generated Contracts are 3-column.)
// ===========================================================================

export const SYSTEM_EXTRACT = `<role>
You are a legal document parser.
</role>
<output_rules>
- Emit EXACTLY ONE valid JSON object — no prose, no markdown.
- Preserve the source wording verbatim where possible; only normalize whitespace.
- Title each section in the same language as the source.
- If a standard section is not present in the source, omit it — do not invent.
</output_rules>`;

export function buildExtractPrompt(args: {
  jurisdiction: string;
  language: string;
  type: ContractType;
  rawText: string;
}): string {
  return `<task>parse_contract</task>

<jurisdiction>${args.jurisdiction}</jurisdiction>
<source_language>${args.language}</source_language>
<contract_type>${args.type}</contract_type>

<source_text>
${cdata(args.rawText)}
</source_text>

<output_schema>
{
  "metadata": { "jurisdiction": "${args.jurisdiction}", "language": "${args.language}", "type": "${args.type}" },
  "sections": [
    { "id": "<snake_case_id>", "title": "<localized title from source>", "content": "<verbatim clause text>" }
  ]
}
</output_schema>

<preferred_section_ids>
header, parties, property, term, payment, deposit, utilities, maintenance, termination, governing_law, signatures
</preferred_section_ids>
<additional_sections_allowed>
Use additional snake_case ids for anything else present in the source (e.g. "guarantor", "indexation", "early_termination", "late_fees").
</additional_sections_allowed>

Emit the JSON now.`;
}
