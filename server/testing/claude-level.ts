// The Sagax level a fake Claude CLI was launched at, read from its argv.
// Since 2026-10-19 Approve for me launches `--permission-mode acceptEdits`
// with the fixed allowlist (drivers/claude.ts CLAUDE_AUTO_ALLOWED_TOOLS),
// never the CLI's own `auto`, so the mode alone no longer tells Auto from
// Edits. Self-contained (the scripted agent runs as a bare subprocess);
// claude.test.ts pins the copy below to the driver's list.
export const AUTO_ALLOWLIST_COPY: readonly string[] = [
  "WebSearch", "TodoWrite", "ToolSearch", "Task", "Bash(pwd)",
];

export function claudeLaunchLevel(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--permission-mode");
  if (at < 0) return undefined;
  const mode = argv[at + 1];
  const allowedAt = argv.indexOf("--allowedTools");
  const allowed = allowedAt >= 0 ? String(argv[allowedAt + 1] ?? "").split(",") : [];
  if (mode === "acceptEdits" && AUTO_ALLOWLIST_COPY.every((tool) => allowed.includes(tool))) return "auto";
  return mode;
}
