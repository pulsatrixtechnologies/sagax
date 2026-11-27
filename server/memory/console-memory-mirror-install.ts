// #4461: wire the console memory mirror onto journaled bot memory writes and
// person-scoped team memory saves. One registration from server/index.ts.
import { readFileSync, statSync } from "node:fs";

import { onMemoryChange } from "./memory-journal.ts";
import {
  ConsoleMemoryMirror,
  isMirroredMemoryPath,
  mirrorRemoteFrom,
  type ConsoleMemoryMirror as Mirror,
} from "./console-memory-mirror.ts";
import { parseMemoryEntries } from "./memory-entries.ts";
import type { PerspicaxMemoryNotesClient } from "./perspicax-memory-notes.ts";
import type { TeamMemoryEntry } from "./team-memory.ts";
import { resolveMemoryPath } from "./memory-store.ts";

export interface MirrorInstallDeps {
  client: PerspicaxMemoryNotesClient;
  /** False on a solo install or when Perspicax is not linked. */
  enabled: () => boolean;
  /** Owner principal of a bot, or null when unknown / solo. */
  ownerOf: (botId: string) => string | null;
  /** Display name of a bot. */
  botName: (botId: string) => string;
  log?: (line: string) => void;
}

export interface MirrorInstall {
  mirror: Mirror;
  /** Stop the journal listener. */
  stop: () => void;
  /** Mirror one bot memory path now (tool writes that skip the journal). */
  onBotMemoryWritten: (botId: string, path?: string) => void;
  /** Bring existing MEMORY.md + mirrored files of one bot into the console. */
  bringInBot: (botId: string) => Promise<number>;
  /** Bring one team-memory entry into scope me. */
  bringInTeamEntry: (principalId: string, entry: TeamMemoryEntry) => Promise<boolean>;
  /** After a team-memory save on an org server. */
  onTeamEntrySaved: (principalId: string, entry: TeamMemoryEntry) => void;
  /**
   * Pull console edits/deletes for this person. Team entry keys (`team:<id>`)
   * update or remove the local team-memory row; bot MEMORY.md keys are
   * applied when `applyBotEntry` is given.
   */
  pullForPrincipal: (
    principalId: string,
    handlers?: {
      applyTeamEdit?: (entryId: string, body: string, title: string) => void;
      applyTeamDelete?: (entryId: string) => void;
    },
  ) => Promise<{ edited: number; deleted: number }>;
}

function readText(botId: string, path: string): string | null {
  try {
    return readFileSync(resolveMemoryPath(botId, path), "utf8");
  } catch {
    return null;
  }
}

function mtimeMs(botId: string, path: string): number {
  try {
    return statSync(resolveMemoryPath(botId, path)).mtimeMs;
  } catch {
    return Date.now();
  }
}

/** Install the mirror. Safe to call when disabled: listeners still no-op. */
export function installConsoleMemoryMirror(deps: MirrorInstallDeps): MirrorInstall {
  const mirror = new ConsoleMemoryMirror({
    client: mirrorRemoteFrom(deps.client),
    enabled: deps.enabled,
    log: deps.log,
  });

  const pushFile = (botId: string, path: string): void => {
    if (!deps.enabled() || !isMirroredMemoryPath(path)) return;
    const principalId = deps.ownerOf(botId);
    if (!principalId) return;
    const name = deps.botName(botId);
    const text = readText(botId, path);
    if (text === null) {
      void mirror.forget(principalId, `bot:${botId}:${path}`);
      return;
    }
    void (async () => {
      if (path === "MEMORY.md") {
        await mirror.bringInMemoryIndex(principalId, botId, name, text);
        return;
      }
      await mirror.bringInMemoryFile(
        principalId,
        `bot:${botId}:${path}`,
        name,
        path,
        text,
        mtimeMs(botId, path),
      );
    })().catch(() => {
      deps.log?.("console-memory-mirror: push failed");
    });
  };

  const stop = onMemoryChange((botId, path) => {
    pushFile(botId, path);
  });

  return {
    mirror,
    stop,
    onBotMemoryWritten(botId, path = "MEMORY.md") {
      pushFile(botId, path);
    },
    async bringInBot(botId) {
      if (!deps.enabled()) return 0;
      const principalId = deps.ownerOf(botId);
      if (!principalId) return 0;
      const name = deps.botName(botId);
      let count = 0;
      const index = readText(botId, "MEMORY.md");
      if (index !== null) count += await mirror.bringInMemoryIndex(principalId, botId, name, index);
      for (const path of ["memory/company.md", "memory/procedures.md"] as const) {
        const text = readText(botId, path);
        if (text === null) continue;
        if (await mirror.bringInMemoryFile(principalId, `bot:${botId}:${path}`, name, path, text, mtimeMs(botId, path))) {
          count += 1;
        }
      }
      // Topic files named in the index as wiki links are brought when edited;
      // a full topic walk stays on the memory page's own browse.
      return count;
    },
    bringInTeamEntry: (principalId, entry) => mirror.bringInTeamEntry(principalId, entry),
    onTeamEntrySaved(principalId, entry) {
      if (!deps.enabled()) return;
      void mirror.bringInTeamEntry(principalId, entry).catch(() => {
        deps.log?.("console-memory-mirror: team push failed");
      });
    },
    pullForPrincipal(principalId, handlers = {}) {
      return mirror.pull(principalId, {
        applyEdit: (localKey, body, title) => {
          const team = /^team:(.+)$/.exec(localKey);
          if (team) handlers.applyTeamEdit?.(team[1]!, body, title);
        },
        applyDelete: (localKey) => {
          const team = /^team:(.+)$/.exec(localKey);
          if (team) handlers.applyTeamDelete?.(team[1]!);
        },
      });
    },
  };
}

/** Apply a pulled console edit onto a bot MEMORY.md entry body (exact match). */
export function replaceMemoryEntryBody(text: string, fromBody: string, toBody: string): string | null {
  const entries = parseMemoryEntries(text);
  const hit = entries.find((entry) => entry.body === fromBody);
  if (!hit) return null;
  const lines = text.split("\n");
  const head = hit.raw.replace(hit.body, toBody);
  lines.splice(hit.line, hit.end - hit.line, head);
  return lines.join("\n");
}

