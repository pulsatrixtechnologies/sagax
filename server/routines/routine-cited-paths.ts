// #1996: the paths a routine's instructions cite that cannot be found.
// run_routine action check reports them as warnings only: a missing path
// never blocks a run (it may be created by the run itself, or live on
// another machine).

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CitedPathWarning {
  code: "path_missing";
  path: string;
  /** 1-based line of the instructions that cites it. */
  line: number;
  message: string;
}

const CITED_MAX = 20;
// An absolute path (/Users/..., /opt/...) or a home path (~/...), at the
// start of a word, quoted or in backticks. A URL's path is never one.
const PATH = /(?<![\w:/.~-])(~\/[^\s`'"<>()[\]{},;]+|\/(?:[\w.@+-]+\/)*[\w.@+-]+\/?)/g;
const TRAILING = /[.,:;!?)\]}]+$/;

/** The absolute and ~/ paths an instructions text cites, once each, in order. */
export function citedPaths(text: string): Array<{ path: string; line: number }> {
  const out: Array<{ path: string; line: number }> = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (let index = 0; index < lines.length && out.length < CITED_MAX; index++) {
    for (const match of lines[index]!.matchAll(PATH)) {
      const path = match[1]!.replace(TRAILING, "");
      // an absolute path needs two parts: a lone "/api" or "/s" is prose
      if (path.length < 3 || path.startsWith("/") && !path.slice(1).replace(/\/$/, "").includes("/")) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, line: index + 1 });
      if (out.length >= CITED_MAX) break;
    }
  }
  return out;
}

/** The cited paths that do not exist where the check runs. */
export function missingCitedPaths(text: string, exists: (path: string) => boolean = existsSync, home: string = homedir()): CitedPathWarning[] {
  const warnings: CitedPathWarning[] = [];
  for (const { path, line } of citedPaths(text)) {
    const resolved = path.startsWith("~/") ? join(home, path.slice(2)) : path;
    let found = false;
    try { found = exists(resolved); } catch { found = false; }
    if (!found) warnings.push({ code: "path_missing", path, line, message: `Line ${line} cites ${path}, which cannot be found. The run still starts.` });
  }
  return warnings;
}
