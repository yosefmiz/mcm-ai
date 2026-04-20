import { z } from "zod";

export const LanguageEnum = z.enum(["HE", "EN", "RU", "AR"]);
export const ContractTypeEnum = z.enum(["ANNUAL", "SUBLET", "MANAGEMENT"]);

export type LanguageT = z.infer<typeof LanguageEnum>;
export type ContractTypeT = z.infer<typeof ContractTypeEnum>;

export const ContractSectionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "id must be snake_case ascii"),
  title: z.string().min(1),
  content: z.string().min(1),
});

export const ContractMetadataSchema = z.object({
  jurisdiction: z.string().min(2),
  language: LanguageEnum,
  type: ContractTypeEnum,
});

export const ContractDocumentSchema = z.object({
  metadata: ContractMetadataSchema,
  sections: z.array(ContractSectionSchema).min(1),
});

export type ContractDocument = z.infer<typeof ContractDocumentSchema>;
export type ContractSection = z.infer<typeof ContractSectionSchema>;

export const GenerateRequestSchema = z.object({
  jurisdiction: z.string().min(2),
  language: LanguageEnum,
  type: ContractTypeEnum,
  inputs: z.record(z.string(), z.unknown()),
});

export const EditRequestSchema = z.object({
  contractId: z.string().min(1),
  sectionId: z.string().min(1),
  userInstruction: z.string().min(1).max(2000),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type EditRequest = z.infer<typeof EditRequestSchema>;
