// 2026-11-02 (production): a turn whose engine has no file tools on the
// Sagax server (an organization turn withholds them) must never be given a
// path of that server. The bot took /data/.openmausbot/workspaces/<id> (the
// "File locations" block) for its own folder and listed it with the tools of
// its server environment, which run on another machine.
//
// The sections that name files say how the bot reaches each thing instead
// (server/workspace/workspace.ts serverFilesUnreachablePrompt, the memory and skills
// sections). This is the net under them: whatever section still spells a
// server path gets it rewritten, so no new section can bring the confusion
// back. A file of the bot's own Sagax workspace becomes its relative path,
// which workspace_read reads; any other server path says the server keeps it.

/** The prompt section shape (server/system-prompt.ts PromptPart). */
export interface PromptSection {
  id: string;
  label: string;
  text: string;
}

export interface ServerPathView {
  /** The server's data folder, every spelling (as configured, real path). */
  dataDirs: readonly string[];
  /** The bot's own Sagax workspace (workspaces/<bot id>), every spelling. */
  botWorkspaces: readonly string[];
}

/** What a server path outside the bot's workspace reads as. */
export const SERVER_KEPT = "(kept on the Sagax server; use workspace_read, session_search or the Sagax tools to reach it)";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trimSlash = (value: string) => value.replace(/\/+$/, "");
/** The rest of a path: up to a quote, a space, a bracket or the end. */
const REST = "((?:/[^\\s\"'`<>)\\]\\\\,;]*)?)";

function usable(paths: readonly string[]): string[] {
  const out = paths.map((path) => trimSlash(path.trim())).filter((path) => path.startsWith("/") && path.split("/").length >= 2 && path.length > 1);
  // longest first, so a workspace inside the data folder matches as itself
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/** `text` with no path of the Sagax server left in it. */
export function hideServerPaths(text: string, view: ServerPathView): string {
  if (!text) return text;
  let out = text;
  for (const root of usable(view.botWorkspaces)) {
    out = out.replace(new RegExp(`${escapeRegExp(root)}(?=$|[/\\s"'\`<>)\\],;\\\\])${REST}`, "g"), (_match, rest: string) => {
      const relative = rest.replace(/^\/+/, "");
      // the workspace itself, or a climb out of it, names no file of it
      if (!relative || /(?:^|\/)\.\.(?:\/|$)/.test(relative)) return SERVER_KEPT;
      return relative;
    });
  }
  for (const root of usable(view.dataDirs)) {
    out = out.replace(new RegExp(`${escapeRegExp(root)}(?=$|[/\\s"'\`<>)\\],;\\\\])${REST}`, "g"), () => SERVER_KEPT);
  }
  return out;
}

/** Every section rewritten, and the ids of those that still spelled a
 * server path (logged by the caller: a section to fix at its source). */
export function hideServerPathsInSections<T extends PromptSection>(sections: readonly T[], view: ServerPathView): { sections: T[]; leaked: string[] } {
  const leaked: string[] = [];
  const out = sections.map((section) => {
    const text = hideServerPaths(section.text, view);
    if (text === section.text) return section;
    leaked.push(section.id);
    return { ...section, text };
  });
  return { sections: out, leaked };
}

/** Whether `text` still names a path under one of the data folders. */
export function namesServerPath(text: string, view: Pick<ServerPathView, "dataDirs">): boolean {
  return usable(view.dataDirs).some((root) => new RegExp(`${escapeRegExp(root)}(?=$|[/\\s"'\`<>)\\],;\\\\])`).test(text));
}
