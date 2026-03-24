import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { documents } from "./documents.js";

export const agentDocuments = pgTable(
  "agent_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentKeyUq: uniqueIndex("agent_documents_company_agent_key_uq").on(
      table.companyId,
      table.agentId,
      table.key,
    ),
    documentUq: uniqueIndex("agent_documents_document_uq").on(table.documentId),
    companyAgentUpdatedIdx: index("agent_documents_company_agent_updated_idx").on(
      table.companyId,
      table.agentId,
      table.updatedAt,
    ),
  }),
);
