// Where in-app feedback is filed (#2618): the GitHub repository and the
// server's own token, set once by an organization admin (PUT
// /api/admin/feedback-config) or by SAGAX_FEEDBACK_GITHUB_TOKEN. The token
// stays on the server: the file is private (0600) and the view an admin
// reads back only says whether one is set.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";

export const DEFAULT_FEEDBACK_REPO = "pulsatrixtechnologies/sagax";
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface FeedbackConfig {
  repo: string;
  token?: string;
  source: "env" | "file" | null;
}

export interface FeedbackConfigView {
  repo: string;
  tokenSet: boolean;
  source: "env" | "file" | null;
}

interface StoredConfig {
  repo?: string;
  token?: string;
}

function configPath(dataDir: string): string {
  return join(dataDir, "feedback", "config.json");
}

function readStored(dataDir: string): StoredConfig {
  const path = configPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as StoredConfig;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function readFeedbackConfig(dataDir: string, env: Record<string, string | undefined> = process.env): FeedbackConfig {
  const stored = readStored(dataDir);
  const envToken = env.SAGAX_FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = env.SAGAX_FEEDBACK_REPO?.trim() || stored.repo || DEFAULT_FEEDBACK_REPO;
  if (envToken) return { repo, token: envToken, source: "env" };
  if (stored.token) return { repo, token: stored.token, source: "file" };
  return { repo, source: null };
}

/** token null removes it; undefined keeps it. */
export function writeFeedbackConfig(dataDir: string, patch: { repo?: string; token?: string | null }): void {
  if (patch.repo !== undefined && !REPO.test(patch.repo.trim())) throw Object.assign(new Error("repo must read owner/name"), { status: 400 });
  const stored = readStored(dataDir);
  const next: StoredConfig = { ...stored };
  if (patch.repo !== undefined) next.repo = patch.repo.trim();
  if (patch.token === null) delete next.token;
  else if (typeof patch.token === "string" && patch.token.trim()) next.token = patch.token.trim();
  mkdirSync(join(dataDir, "feedback"), { recursive: true, mode: 0o700 });
  writeFileAtomic(configPath(dataDir), JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function feedbackConfigView(config: FeedbackConfig): FeedbackConfigView {
  return { repo: config.repo, tokenSet: Boolean(config.token), source: config.source };
}
