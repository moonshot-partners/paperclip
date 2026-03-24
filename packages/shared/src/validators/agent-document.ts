import { z } from "zod";

export const documentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Document key must be lowercase letters, numbers, _ or -");

export const upsertAgentDocumentSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  format: z.enum(["markdown"]),
  body: z.string().max(524288),
  changeSummary: z.string().trim().max(500).nullable().optional(),
  baseRevisionId: z.string().uuid().nullable().optional(),
});

export type UpsertAgentDocument = z.infer<typeof upsertAgentDocumentSchema>;
