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
  content_legal: z.string().min(1),
  content_bridge: z.string().min(1),
  content_ui: z.string().min(1),
});

export type ContractSection = z.infer<typeof ContractSectionSchema>;

// ---------------------------------------------------------------------------
// Document metadata + the full contract document
// ---------------------------------------------------------------------------

export const ContractMetadataSchema = z.object({
  jurisdiction: z.string().min(2),
  jurisdictionLanguage: IsoLanguageSchema,
  bridgeLanguage: IsoLanguageSchema,
  uiLanguage: IsoLanguageSchema,
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

export const GenerateRequestSchema = z.object({
  jurisdiction: z.string().min(2),
  jurisdictionLanguage: IsoLanguageSchema,
  bridgeLanguage: IsoLanguageSchema,
  uiLanguage: IsoLanguageSchema,
  type: ContractTypeEnum,
  inputs: z.record(z.string(), z.unknown()),
  // Optional audit-trail context. If the consumer is collecting acceptance
  // server-side they can pass it on creation; otherwise the dedicated
  // acceptance endpoint can update later.
  acceptedByUserId: z.string().min(1).max(200).optional(),
});

export const EditRequestSchema = z.object({
  contractId: z.string().min(1),
  sectionId: z.string().min(1),
  userInstruction: z.string().min(1).max(2000),
  acceptedByUserId: z.string().min(1).max(200).optional(),
});

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
