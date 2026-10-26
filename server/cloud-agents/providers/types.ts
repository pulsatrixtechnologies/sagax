import type {
  CloudAgentArtifact,
  CloudAgentFollowUpInput,
  CloudAgentLaunchInput,
  CloudAgentProviderId,
  CloudAgentRecord,
  CloudAgentTranscriptLine,
} from "../../../shared/cloud-agents.ts";

export interface ProviderLaunchResult {
  externalId: string;
  name: string;
  latestRunId?: string;
  url?: string;
  status: string;
  envId?: string;
  origin?: CloudAgentRecord["origin"];
}

export interface ProviderRunSnapshot {
  status: string;
  result?: string;
  error?: string;
  latestRunId?: string;
  gitBranches?: CloudAgentRecord["gitBranches"];
  stats?: CloudAgentRecord["stats"];
  pr?: CloudAgentRecord["pr"];
  unread?: boolean;
  url?: string;
}

export interface CloudAgentProviderAdapter {
  id: CloudAgentProviderId;
  label: string;
  /** Verify an API key without launching an agent. */
  testToken(token: string): Promise<void>;
  launch(token: string, input: CloudAgentLaunchInput): Promise<ProviderLaunchResult>;
  refresh(token: string, record: CloudAgentRecord): Promise<ProviderRunSnapshot>;
  followUp(token: string, record: CloudAgentRecord, input: CloudAgentFollowUpInput): Promise<ProviderRunSnapshot>;
  cancel(token: string, record: CloudAgentRecord): Promise<void>;
  archive(token: string, record: CloudAgentRecord): Promise<void>;
  listArtifacts(token: string, record: CloudAgentRecord): Promise<CloudAgentArtifact[]>;
  transcript(token: string, record: CloudAgentRecord): Promise<CloudAgentTranscriptLine[]>;
  findByPr(token: string, prUrl: string): Promise<{ externalId: string; name: string } | null>;
}

export type HttpFetch = typeof fetch;
