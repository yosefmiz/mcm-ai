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

/**
 * Format reference templates as clearly-prose Markdown so the model does
 * not mistake their shape for the expected JSON output schema. The old
 * JSON-ish "[id] content" format caused gemma4 to emit the wrong field
 * name ("content" instead of content_legal / content_bridge / content_ui)
 * on generation, producing malformed JSON.
 */
const formatTemplates = (refs: TemplateRef[]): string =>
  refs.length === 0
    ? "(none on file)"
    : refs
        .map(
          (ref, i) =>
            `### Reference ${i + 1}: ${ref.title} (${ref.language})\n\n` +
            ref.sections
              .map((s) => `**${s.title}**\n\n${s.content}`)
              .join("\n\n---\n\n"),
        )
        .join("\n\n=====\n\n");

// ===========================================================================
// GENERATE — full contract authoring (3-language native composition)
// ===========================================================================

export const SYSTEM_GENERATE = `<role>
You are MyHome's senior real-estate contract drafter and licensed paralegal AI.
You author the contract in ONE language only — the jurisdiction_language —
using its native legal register and standard local boilerplate.
Translation into other languages is performed later by a separate step.
</role>

<output_rules>
- Emit EXACTLY ONE valid JSON object that matches <output_schema>.
- No prose, no markdown fences, no commentary, no apology, no preamble.
- Every section has exactly two fields: "id" (snake_case ascii) and
  "content" (the full clause body in jurisdiction_language).
- Hebrew (he) and Arabic (ar) are written naturally right-to-left without
  any inserted Unicode bidi marks; clients render direction from metadata.
- Honor every <legal_constraint> with absolute priority. If a user input
  conflicts with a constraint, the constraint wins and the relevant section
  names the lawful limit.
- Use any <glossary> entry whose language matches jurisdiction_language as
  the required_wording verbatim wherever the concept appears.
- Use <reference_templates> for structural anchoring and tone, NEVER copy
  verbatim. Adapt to the user's specifics.
- The FINAL section MUST be id="language_waiver" — see
  <language_waiver_requirements>.
</output_rules>

<deal_facts_rules>
- The <deal_facts> block contains GROUND TRUTH from the database: the
  parties' real names, ID numbers, the property address, the agreed rent
  and dates. You MUST use these values verbatim wherever they apply in the
  contract.
- NEVER invent, paraphrase, or substitute different values for any fact
  appearing in <deal_facts>. Names, numbers, dates, and addresses are
  copied as written.
- For any specific atom NOT present in <deal_facts> (and not present in
  <inputs>), insert a placeholder in the form [[FIELD_NAME]] using
  SCREAMING_SNAKE_CASE in English. Never fabricate a value to fill a gap.
- If <deal_facts> is empty (the route did not load any CRM entities),
  treat <inputs> as the only source of truth and placeholder everything
  else.
</deal_facts_rules>

<completeness_and_placeholders>
- Always produce the FULL contract with every standard clause fully drafted,
  even when <inputs> is sparse. Do NOT shorten the document or omit clauses
  to mask missing facts.
- For ANY specific fact that <inputs> does not supply (a name, an address,
  an amount, a date, a duration, a percentage, an account number, etc.),
  insert a placeholder token in this exact form:
      [[FIELD_NAME]]
  where FIELD_NAME is SCREAMING_SNAKE_CASE in English, descriptive,
  consistent across the whole document. Examples:
      [[LANDLORD_FULL_NAME]], [[TENANT_ID_NUMBER]], [[MONTHLY_RENT_AMOUNT]],
      [[LEASE_START_DATE]], [[SECURITY_DEPOSIT_AMOUNT]],
      [[PROPERTY_FULL_ADDRESS]].
- Use the SAME placeholder verbatim wherever the same fact appears.
- Never fabricate a specific value to fill a missing fact. Never write
  "[insert name]" or "_____" — only the [[FIELD_NAME]] form is allowed.
- The surrounding clause text is still written in full natural legal
  language; the placeholder simply stands in for the unknown atom.
</completeness_and_placeholders>`;

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
  /** Plain-text Fact Sheet from lib/context-builder. Empty string is fine. */
  dealFacts?: string;
}

export function buildGeneratePrompt(args: BuildGenerateArgs): string {
  return `<task>generate_contract</task>

<jurisdiction>${args.jurisdiction}</jurisdiction>
<contract_type>${args.type}</contract_type>
<jurisdiction_language>${args.jurisdictionLanguage}</jurisdiction_language>
<bridge_language>${args.bridgeLanguage}</bridge_language>
<ui_language>${args.uiLanguage}</ui_language>

<deal_facts>
${cdata(args.dealFacts && args.dealFacts.trim().length > 0 ? args.dealFacts : "(no CRM entities resolved — rely on <inputs> only)")}
</deal_facts>

<inputs>
${cdata(JSON.stringify(args.inputs, null, 2))}
</inputs>

<legal_constraints>
${cdata(formatConstraints(args.constraints))}
</legal_constraints>

<glossary>
${cdata(formatGlossary(args.glossary))}
</glossary>

<reference_templates_note>
The reference templates below are PROSE EXAMPLES of contracts previously
drafted in this jurisdiction. They are written in ONE language and use
regular prose headings. They are NOT a shape template for your output.
IGNORE their structure and field names. YOUR OUTPUT MUST use exactly the
three fields content_legal, content_bridge, content_ui — never a single
"content" field.
</reference_templates_note>

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
Its content (in ${args.jurisdictionLanguage}, native legal register) MUST explicitly state:
  1. The parties have read and understood this agreement.
  2. They voluntarily waive the right to a sworn translator.
  3. They acknowledge that the ${args.jurisdictionLanguage} version GOVERNS in case of any dispute.
  4. Any later translation provided to the parties is for convenience only and has no independent legal force.
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
      "content": "<full clause body in ${args.jurisdictionLanguage}>"
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
You output the revised clause in ONE language — the jurisdiction_language.
Translation to other languages is performed later by a separate step.
</role>

<output_rules>
- Emit EXACTLY ONE valid JSON object: { "id", "content" }.
- No prose, no markdown fences, no commentary, no preamble like "Here is".
- Preserve the section's id verbatim from <section_id>.
- The "content" field is the full revised clause body in jurisdiction_language.
- Honor every <legal_constraint>. If the <user_instruction> conflicts with a
  constraint, follow the constraint and emit the lawful version. Do not
  apologize — silently produce the compliant clause.
- Use <glossary> required_wording verbatim wherever the concept appears.
- The <user_instruction> may be written in any language (often the
  ui_language). Understand its intent and apply it.
- Hebrew/Arabic are written right-to-left without bidi marks.
- Do not invent facts not present in <deal_facts>, the current clause, or
  the instruction.
- Preserve any [[FIELD_NAME]] placeholders already present in the current
  clause unless the <user_instruction> explicitly supplies a value for them
  OR the value can be filled from <deal_facts>.
- For any new specific fact you would otherwise need to invent, insert a
  [[SCREAMING_SNAKE_CASE]] placeholder rather than fabricating it.
</output_rules>

<deal_facts_rules>
- The <deal_facts> block is GROUND TRUTH from the CRM. Names, addresses,
  amounts, and dates inside it are correct and must be used verbatim if
  the revised clause needs them.
- The <user_instruction> may override a deal fact (e.g. "change the rent
  to 5000"). When it does, follow the instruction and override.
</deal_facts_rules>`;

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
  dealFacts?: string;
}

export function buildEditPrompt(args: BuildEditArgs): string {
  return `<task>edit_section</task>

<jurisdiction>${args.jurisdiction}</jurisdiction>
<contract_type>${args.type}</contract_type>
<jurisdiction_language>${args.jurisdictionLanguage}</jurisdiction_language>
<bridge_language>${args.bridgeLanguage}</bridge_language>
<ui_language>${args.uiLanguage}</ui_language>

<section_id>${args.sectionId}</section_id>

<deal_facts>
${cdata(args.dealFacts && args.dealFacts.trim().length > 0 ? args.dealFacts : "(no CRM entities resolved)")}
</deal_facts>

<current_clause language="${args.jurisdictionLanguage}">
${cdata(args.current.content_legal)}
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
  "content": "<revised clause body in ${args.jurisdictionLanguage}>"
}
</output_schema>

Emit the JSON now.`;
}

// ===========================================================================
// TRANSLATE — render an existing clause from source language to target
// ===========================================================================

export const SYSTEM_TRANSLATE_SECTION = `<role>
You are a legal translator. You translate a single contract clause from a
source language into a target language for the parties' convenience.
</role>

<output_rules>
- Emit EXACTLY ONE valid JSON object: { "id", "content" }.
- No prose, no markdown fences, no commentary.
- Preserve the section "id" verbatim from <section_id>.
- The translation is FAITHFUL to the source — do not add, omit, or restate
  in different terms. Use the target language's natural legal register.
- Preserve every [[FIELD_NAME]] placeholder verbatim in English uppercase
  with the [[ ]] brackets — never translate or localize them.
- Preserve the structure: paragraphs, numbered lists, dashes.
- Hebrew/Arabic are written right-to-left without bidi marks.
- Do not include any disclaimer about translation accuracy.
</output_rules>`;

export function buildTranslatePrompt(args: {
  sectionId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
  glossary: GlossaryRow[];
}): string {
  return `<task>translate_section</task>

<section_id>${args.sectionId}</section_id>
<source_language>${args.sourceLanguage}</source_language>
<target_language>${args.targetLanguage}</target_language>

<source_content>
${cdata(args.sourceContent)}
</source_content>

<glossary language="${args.targetLanguage}">
${cdata(formatGlossary(args.glossary))}
</glossary>

<output_schema>
{
  "id": "${args.sectionId}",
  "content": "<faithful translation of source_content into ${args.targetLanguage}>"
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

// ===========================================================================
// CHAT ROUTING — classify intent and extract contract-generation params
// ===========================================================================

export const SYSTEM_ROUTE_CHAT = `<role>
You route a user's message in MyHome's chat. You decide whether the user is
asking us to DRAFT a real-estate contract or just chatting / asking a
question, and if drafting, you extract the parameters.
</role>

<output_rules>
- Emit EXACTLY ONE JSON object matching <output_schema>. No prose, no markdown.
- Choose intent="generate_contract" when the user asks to draft, create, write,
  generate, prepare, build, or produce a real-estate contract, lease,
  rental agreement, sublet, or management agreement — even if the request
  is short and lacks details.
- Otherwise intent="chat".

<routing_examples>
- "Draft a lease for an apartment in Brooklyn" -> generate_contract (jurisdiction "NY, US", jurisdiction_language "en", type ANNUAL)
- "צור לי חוזה לדירה בתל אביב" -> generate_contract (jurisdiction "IL", jurisdiction_language "he", ui_language "he", type ANNUAL)
- "צור חוזה מקצועי לשכירות שנתית" -> generate_contract (jurisdiction inferred from ui_language_hint, type ANNUAL)
- "תנסח לי הסכם שכירות משנה לחודש" -> generate_contract (type SUBLET)
- "הכן חוזה ניהול נכס" -> generate_contract (type MANAGEMENT)
- "Создай договор аренды квартиры в Москве" -> generate_contract (jurisdiction "RU", jurisdiction_language "ru", type ANNUAL)
- "أنشئ عقد إيجار شقة في دبي" -> generate_contract (jurisdiction "AE", jurisdiction_language "ar", type ANNUAL)
- "What is a security deposit?" -> chat
- "מה הכללים לפיקדון בישראל?" -> chat
- "Can a landlord evict without notice?" -> chat
- "I want to know my rights" -> chat
</routing_examples>

The phrases "צור", "תנסח", "הכן", "תכין", "תכתוב", "create", "draft", "generate", "make", "write", "prepare", "build", "produce" combined with any of "חוזה", "הסכם", "contract", "lease", "agreement", "rental", "договор", "аренда", "عقد", "إيجار" are HARD triggers for generate_contract.
- For intent="generate_contract" you MUST fill all five language/type
  parameters with reasonable defaults inferred from the message:
    jurisdiction: a short jurisdiction code derived from any city or
      country the user named ("Tel Aviv" -> "IL", "Brooklyn" -> "NY, US",
      "Berlin" -> "DE-BE", "Athens" -> "GR"). If nothing is named, fall
      back to ui_language_hint (he->IL, en->"NY, US", ru->RU, ar->AE).
    jurisdiction_language: the ISO 639-1 lowercase code that is the
      official legal language of that jurisdiction (IL->he, NY,US->en,
      DE-BE->de, GR->el, RU->ru, AE->ar).
    bridge_language: ISO 639-1; default "en" unless the user clearly
      implied another shared language for the parties.
    ui_language: ISO 639-1; the language the user wrote their request in
      (or ui_language_hint as a fallback).
    type: "ANNUAL" by default; "SUBLET" if the user said sublet / short
      term / vacation; "MANAGEMENT" if they said property management /
      ניהול נכס.
    inputs: any specific facts the user mentioned — landlord/tenant
      names, address, rent amount, dates, deposit, etc. Use the
      SCREAMING_SNAKE_CASE keys our generator expects when sensible
      (LANDLORD_FULL_NAME, TENANT_FULL_NAME, PROPERTY_FULL_ADDRESS,
      MONTHLY_RENT_AMOUNT, LEASE_START_DATE, LEASE_TERM_MONTHS,
      SECURITY_DEPOSIT_AMOUNT). Use {} when nothing was supplied — the
      generator will fill placeholders.
- Never invent facts that the user did not say.
</output_rules>`;

export function buildRouteChatPrompt(args: {
  message: string;
  uiLanguageHint: string;
}): string {
  return `<task>route_chat_turn</task>

<ui_language_hint>${args.uiLanguageHint}</ui_language_hint>

<user_message>
${args.message.replace(/]]>/g, "]]]]><![CDATA[>")}
</user_message>

<output_schema>
{
  "intent": "chat" | "generate_contract",
  "generate": {
    "jurisdiction": "<string>",
    "jurisdiction_language": "<iso>",
    "bridge_language": "<iso>",
    "ui_language": "<iso>",
    "type": "ANNUAL" | "SUBLET" | "MANAGEMENT",
    "inputs": { "<KEY>": "<value>" }
  }
}
</output_schema>

If intent="chat", omit the "generate" object. Emit the JSON now.`;
}

// ===========================================================================
// FACT EXTRACTION — natural-language instruction → structured facts map
// ===========================================================================

export const SYSTEM_EXTRACT_FACTS = `<role>
You convert a free-text instruction into a structured map of contract facts.
</role>
<output_rules>
- Emit EXACTLY ONE JSON object: { "facts": { "FIELD_NAME": "value", ... } }.
- No prose, no markdown.
- Keys are SCREAMING_SNAKE_CASE in English; values are short literal strings
  (the actual name, amount, date, address, etc.) in whatever language they
  were given.
- If the instruction maps to one of the suggested known fields, prefer that
  exact key. Otherwise invent a clear new key.
- If the instruction provides nothing extractable, return { "facts": {} }.
</output_rules>`;

export function buildExtractFactsPrompt(args: {
  instruction: string;
  knownFields: string[];
}): string {
  return `<task>extract_facts</task>

<known_field_names>
${args.knownFields.length === 0 ? "(none — invent appropriate keys)" : args.knownFields.join(", ")}
</known_field_names>

<instruction>
${args.instruction.replace(/]]>/g, "]]]]><![CDATA[>")}
</instruction>

<output_schema>
{ "facts": { "FIELD_NAME": "literal value", "...": "..." } }
</output_schema>

Emit the JSON now.`;
}

// ===========================================================================
// EXTRACT — raw uploaded contract → structured single-content sections.
// (Templates remain single-content; only generated Contracts are 3-column.)
// ===========================================================================

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
