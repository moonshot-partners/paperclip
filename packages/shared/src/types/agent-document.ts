import type { DocumentFormat } from "./issue.js";

export interface AgentDocumentSummary {
  id: string;
  companyId: string;
  agentId: string;
  key: string;
  title: string | null;
  format: DocumentFormat;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  updatedByAgentId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentDocument extends AgentDocumentSummary {
  body: string;
}

export interface AgentDocumentRevision {
  id: string;
  companyId: string;
  documentId: string;
  agentId: string;
  key: string;
  revisionNumber: number;
  body: string;
  changeSummary: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}
