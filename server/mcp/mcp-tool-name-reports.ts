// Reads the tool-name reports the MCP gates write (mcp-gate.ts,
// SAGAX_GATE_REPORT_DIR): one per connector, the latest catalog it relayed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { toolNameReportDir } from "./mcp-gate-config.ts";

export interface ToolNameReport {
  server: string;
  engine: string;
  at: string;
  advertised: number;
  registered: number;
  renamed: Array<{ upstream: string; registered: string; reason: string }>;
  unregistrable: Array<{ upstream: string; reason: string }>;
  parity: string[];
  status: "ok" | "renamed" | "mismatch";
}

export function readToolNameReports(dir = toolNameReportDir()): ToolNameReport[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return []; }
  const reports: ToolNameReport[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const value = JSON.parse(readFileSync(join(dir, entry), "utf8")) as ToolNameReport;
      if (value && typeof value.server === "string" && typeof value.status === "string") reports.push(value);
    } catch { /* a report being written is read next time */ }
  }
  return reports;
}
