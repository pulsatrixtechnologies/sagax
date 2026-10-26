// What the pods read from the transcript the chat already holds. Pure
// functions, no request: when the transcript does not say it, the answer is
// nothing (never a guess dressed as data).
import { parseGithubUrl } from "@/lib/github-refs";
import { isOpaqueId, sagaxFolder } from "../../../shared/human-id";
import { sagaxFolderLabel } from "@/lib/short-path";
import type { Message } from "@/state/store";
import { toolKind } from "./detector";

function toolText(message: Message): { command: string; output: string } {
  const tool = message.tool;
  return { command: `${tool?.summary ?? ""}\n${tool?.input ?? ""}`, output: tool?.output ?? "" };
}

const BRANCH = "([\\w][\\w./-]{0,120})";
const BRANCH_FROM_COMMAND = [
  new RegExp(`git\\s+(?:checkout|switch)\\s+(?:-[bBcC]\\s+)?${BRANCH}`),
  new RegExp(`git\\s+worktree\\s+add\\s+(?:-[bB]\\s+)${BRANCH}`),
];
const BRANCH_FROM_OUTPUT = [
  new RegExp(`Switched to (?:a new )?branch '${BRANCH}'`),
  new RegExp(`On branch ${BRANCH}`),
  // git commit: "[feat/x 1a2b3c4] title"
  new RegExp(`^\\[${BRANCH}(?: \\(root-commit\\))? [0-9a-f]{7,40}\\]`, "m"),
];

/** The branch the bot last moved to or committed on, from its git commands
 * and their output, newest first. Undefined when no git row says it. */
export function currentBranch(messages: readonly Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.kind !== "activity" || !message.tool || message.tool.ok === false) continue;
    const { command, output } = toolText(message);
    for (const pattern of BRANCH_FROM_OUTPUT) {
      const match = pattern.exec(output);
      if (match?.[1]) return match[1];
    }
    for (const pattern of BRANCH_FROM_COMMAND) {
      const match = pattern.exec(command);
      // `git checkout -- file` or `git switch -` are not branches
      if (match?.[1] && !match[1].startsWith("-") && !/[.](?:tsx?|jsx?|json|md)$/.test(match[1])) return match[1];
    }
  }
  return undefined;
}

export interface DevChange {
  key: string;
  kind: "pull" | "commit";
  title: string;
  /** owner/repo when known */
  repo?: string;
  number?: number;
  sha?: string;
  url?: string;
  messageId: string;
}

const PR_URLS = /https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/gi;
const COMMIT_LINE = /^\[([\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/m;
const TITLE_FLAG = /--title[= ](?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;
const COMMIT_MESSAGE = /git\s+commit\b[^\n]*?-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;

/** Pull requests and commits the bot made in this conversation, newest
 * first, from its own tool rows (gh pr create, git commit) and the pull
 * request links in its replies. */
export function devChanges(messages: readonly Message[]): DevChange[] {
  const found = new Map<string, DevChange & { titled: boolean }>();
  // Newest first wins its place in the list; a title read from the command
  // (gh pr create --title) wins over the "repo #N" stand-in of a bare link.
  const add = (change: DevChange, titled = true) => {
    const known = found.get(change.key);
    if (!known) found.set(change.key, { ...change, titled });
    else if (titled && !known.titled) found.set(change.key, { ...known, title: change.title, titled });
  };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.kind === "activity" && message.tool && message.tool.ok !== false) {
      const kind = toolKind(message.tool);
      if (kind !== "pr" && kind !== "git") continue;
      const { command, output } = toolText(message);
      for (const url of output.match(PR_URLS) ?? []) {
        const ref = parseGithubUrl(url);
        if (!ref?.number) continue;
        const titled = TITLE_FLAG.exec(command);
        const title = (titled?.[1] ?? titled?.[2] ?? "").replace(/\\"/g, "\"").trim();
        add({
          key: `pull:${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase(),
          kind: "pull",
          title: title || `${ref.repo} #${ref.number}`,
          repo: `${ref.owner}/${ref.repo}`,
          number: ref.number,
          url: ref.url,
          messageId: message.id,
        }, Boolean(title));
      }
      const commit = COMMIT_LINE.exec(output);
      if (commit && /git\s+commit\b/.test(command)) {
        const said = COMMIT_MESSAGE.exec(command);
        add({
          key: `commit:${commit[2]!.slice(0, 7)}`,
          kind: "commit",
          title: (said?.[1] ?? said?.[2] ?? commit[3]!).split("\n")[0]!.trim(),
          sha: commit[2]!,
          messageId: message.id,
        });
      }
      continue;
    }
    if (message.kind === "text" && message.role === "bot" && message.text) {
      for (const url of message.text.match(PR_URLS) ?? []) {
        const ref = parseGithubUrl(url);
        if (!ref?.number) continue;
        add({
          key: `pull:${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase(),
          kind: "pull",
          title: `${ref.repo} #${ref.number}`,
          repo: `${ref.owner}/${ref.repo}`,
          number: ref.number,
          url: ref.url,
          messageId: message.id,
        }, false);
      }
    }
  }
  return [...found.values()].map(({ titled: _titled, ...change }) => change);
}

export interface DevOutput {
  key: string;
  name: string;
  path: string;
  kind: "image" | "file" | "audio";
  messageId: string;
}

function basename(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  try {
    return decodeURIComponent(clean.split("/").filter(Boolean).at(-1) ?? clean);
  } catch {
    return clean.split("/").filter(Boolean).at(-1) ?? clean;
  }
}

/** Files the bot attached to its replies in this conversation, newest
 * first, once each. */
export function devOutputs(messages: readonly Message[]): DevOutput[] {
  const seen = new Set<string>();
  const outputs: DevOutput[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "bot" || !message.attachments?.length) continue;
    for (const attachment of message.attachments) {
      if (seen.has(attachment.path)) continue;
      seen.add(attachment.path);
      outputs.push({
        key: attachment.path,
        name: ("name" in attachment && attachment.name) || basename(attachment.path),
        path: attachment.path,
        kind: attachment.kind,
        messageId: message.id,
      });
    }
  }
  return outputs;
}

/** The last folder segment for a compact label ("/Users/me/sagax" →
 * "sagax"), never an id: a folder Sagax made and named after the bot or the
 * conversation reads as what it is (sagaxFolderLabel), another id segment
 * gives way to the nearest readable one above it. */
export function folderLabel(path: string): string {
  const sagax = sagaxFolder(path);
  if (sagax) return [...sagax.rest].reverse().find((part) => !isOpaqueId(part)) ?? sagaxFolderLabel(sagax.kind);
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  const readable = [...parts].reverse().find((part) => !isOpaqueId(part));
  return readable ?? (parts.length ? sagaxFolderLabel("bot") : path);
}

/** A branch Sagax made for a parallel task is named after the conversation
 * id (sagax/parallel-<id>): it reads as a parallel task's branch. */
export function isParallelTaskBranch(branch: string): boolean {
  return /^sagax\/parallel-[\w-]+$/.test(branch);
}
