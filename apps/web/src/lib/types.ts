export type DocumentKind = 'RESUME' | 'JOB_DESCRIPTION';

export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface User {
  id: string;
  email: string;
}

export interface DocumentView {
  id: string;
  kind: DocumentKind;
  title: string;
  status: DocumentStatus;
  chunkCount: number;
  sourceFilename: string | null;
  byteSize: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionJob {
  documentId: string;
  label: number;
  title: string;
  status: DocumentStatus;
  chunkCount: number;
}

export interface SessionView {
  id: string;
  title: string | null;
  resume: {
    id: string;
    title: string;
    status: DocumentStatus;
    chunkCount: number;
  } | null;
  jobs: SessionJob[];
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  position: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  label: string;
  chunkIndex: number;
  score: number;
  excerpt: string;
}

export interface MessageView {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations: Citation[];
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export type GapSeverity = 'CRITICAL' | 'IMPORTANT' | 'NICE_TO_HAVE';

export interface FitBreakdown {
  overallScore: number;
  summary: string;
  dimensions: { name: string; score: number; rationale: string }[];
  matchedSkills: { skill: string; evidence: string }[];
  gaps: { skill: string; severity: GapSeverity; note: string }[];
  interviewTalkingPoints: string[];
}

export interface FitAnalysis {
  resumeId: string;
  jobId: string;
  jobTitle: string;
  label: string | null;
  overallScore: number;
  breakdown: FitBreakdown;
  model: string;
  computedAt: string;
}

export interface SessionFit {
  resumeId: string | null;
  jobs: {
    documentId: string;
    label: string;
    title: string;
    status: DocumentStatus;
    analysis: FitAnalysis | null;
  }[];
}
