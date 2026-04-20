import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const LanguageEnum = z.enum(["HE", "EN", "RU", "AR"]);
export const ContractTypeEnum = z.enum(["ANNUAL", "SUBLET", "MANAGEMENT"]);

export type LanguageT = z.infer<typeof LanguageEnum>;
export type ContractTypeT = z.infer<typeof ContractTypeEnum>;

// ---------------------------------------------------------------------------
// Languages used in the Holy Trinity API surface.
// We accept any ISO 639-1 lowercase code so the API can serve jurisdictions
// outside our UI language set (Greek, German, Italian, etc.).
// ---------------------------------------------------------------------------

export const IsoLanguageSchema = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})?$/, "expected ISO 639-1 code, e.g. 'en' or 'he'");

// ---------------------------------------------------------------------------
// Section — dual-column structured output.
// Every section carries content in three languages, generated natively
// (NOT machine-translated) by the LLM in a single pass.
// ---------------------------------------------------------------------------

export const ContractSectionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "id must be snake_case ascii"),
  // The canonical, legally binding column — always populated.
  content_legal: z.string().min(1),
  // Translation columns — empty string means "not yet translated".
  // Populated lazily by POST /api/contract/:id/translate.
  content_bridge: z.string().default(""),
  content_ui: z.string().default(""),
});

// ---------------------------------------------------------------------------
// What the LLM emits for the initial generation: single-content sections
// in the jurisdictionLanguage. We then store them with empty bridge/ui
// columns until the user requests a translation.
// ---------------------------------------------------------------------------

export const GeneratedSectionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "id must be snake_case ascii"),
  content: z.string().min(1),
});

export const GeneratedDocumentSchema = z.object({
  metadata: z.object({
    jurisdiction: z.string().min(2),
    jurisdictionLanguage: IsoLanguageSchema,
    bridgeLanguage: IsoLanguageSchema.nullable().optional(),
    uiLanguage: IsoLanguageSchema.nullable().optional(),
    type: ContractTypeEnum,
  }),
  sections: z.array(GeneratedSectionSchema).min(1),
});

export type GeneratedSection = z.infer<typeof GeneratedSectionSchema>;
export type GeneratedDocument = z.infer<typeof GeneratedDocumentSchema>;

export type ContractSection = z.infer<typeof ContractSectionSchema>;

// ---------------------------------------------------------------------------
// Document metadata + the full contract document
// ---------------------------------------------------------------------------

export const ContractMetadataSchema = z.object({
  jurisdiction: z.string().min(2),
  jurisdictionLanguage: IsoLanguageSchema,
  // Bridge / UI languages are present only when the caller requested
  // translations on the original POST. The contract is legally bound by
  // jurisdictionLanguage regardless.
  bridgeLanguage: IsoLanguageSchema.nullable().optional(),
  uiLanguage: IsoLanguageSchema.nullable().optional(),
  type: ContractTypeEnum,
});

export const ContractDocumentSchema = z.object({
  metadata: ContractMetadataSchema,
  sections: z.array(ContractSectionSchema).min(1),
});

export type ContractDocument = z.infer<typeof ContractDocumentSchema>;

// ---------------------------------------------------------------------------
// API request schemas
// ---------------------------------------------------------------------------

// Optional translation request. Each field is the ISO code of the language
// to translate INTO, asynchronously after the primary contract is saved.
// Either or both may be present.
export const TranslateToSchema = z
  .object({
    bridge: IsoLanguageSchema.optional(),
    ui: IsoLanguageSchema.optional(),
  })
  .refine((d) => !!d.bridge || !!d.ui, {
    message: "translateTo must include at least one of 'bridge' or 'ui'",
  });

export const GenerateRequestSchema = z
  .object({
    // Stateful path: pull facts from CRM entities. Any combination of these
    // resolves a Deal context (see lib/context-builder.ts).
    propertyId: z.string().min(1).optional(),
    tenantId: z.string().min(1).optional(),
    dealId: z.string().min(1).optional(),

    // The language the legal contract is written in — required.
    jurisdictionLanguage: IsoLanguageSchema,

    // Optional async translations to perform in the background after
    // returning the primary contract.
    translateTo: TranslateToSchema.optional(),

    // Stateless overrides. When entity IDs are not provided, jurisdiction +
    // type fall back to these. Inputs is a free-form key/value bag for
    // ad-hoc generation (e.g. chat-initiated drafts).
    jurisdiction: z.string().min(2).optional(),
    type: ContractTypeEnum.optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),

    // Optional audit-trail context.
    acceptedByUserId: z.string().min(1).max(200).optional(),
  })
  .refine(
    (d) =>
      !!d.dealId ||
      !!d.propertyId ||
      !!d.tenantId ||
      (!!d.jurisdiction && !!d.type),
    {
      message:
        "Provide CRM ids (dealId / propertyId / tenantId) or stateless jurisdiction + type",
    },
  );

export type TranslateTo = z.infer<typeof TranslateToSchema>;

export const EditRequestSchema = z.object({
  contractId: z.string().min(1),
  sectionId: z.string().min(1),
  userInstruction: z.string().min(1).max(2000),
  acceptedByUserId: z.string().min(1).max(200).optional(),
});

export const TranslateRequestSchema = z.object({
  target: z.enum(["bridge", "ui"]),
  // Optional: limit to a single section. Default = translate all sections
  // whose target column is currently empty.
  sectionId: z.string().min(1).optional(),
});

export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

export const AcceptRequestSchema = z.object({
  contractId: z.string().min(1),
  acceptedByUserId: z.string().min(1).max(200),
});

// ---------------------------------------------------------------------------
// Facts: SCREAMING_SNAKE_CASE keys -> literal values used to substitute
// [[FIELD_NAME]] placeholders left by the generator.
// ---------------------------------------------------------------------------

export const FactKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/, "fact key must be SCREAMING_SNAKE_CASE");

export const FactsMapSchema = z.record(FactKeySchema, z.string().min(1).max(2000));

export const ApplyFactsRequestSchema = z
  .object({
    facts: FactsMapSchema.optional(),
    instruction: z.string().min(1).max(4000).optional(),
  })
  .refine((d) => !!d.facts || !!d.instruction, {
    message: "Provide either 'facts' or 'instruction'",
  });

export type FactsMap = z.infer<typeof FactsMapSchema>;
export type ApplyFactsRequest = z.infer<typeof ApplyFactsRequestSchema>;

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type EditRequest = z.infer<typeof EditRequestSchema>;
export type AcceptRequest = z.infer<typeof AcceptRequestSchema>;

// ---------------------------------------------------------------------------
// Edit response — the AI returns ONLY the updated section.
// ---------------------------------------------------------------------------

export const EditResponseSectionSchema = ContractSectionSchema;
export type EditResponseSection = ContractSection;
