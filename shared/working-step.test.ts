import { describe, expect, it } from "vitest";
import { commandStep, currentWorkingStep, quietAge, shortPathsIn, workingStepFor, type WorkingStepCall } from "./working-step.ts";

// One call, as each engine reports it (server/drivers/*.ts item.started):
// Claude Code names the tool and puts the command beside it, Codex names the
// call by its command line, an ACP agent by its own title or the command, an
// OpenAI-compatible model by its function name with JSON arguments.
const sameEverywhere = (calls: WorkingStepCall[]) => calls.map((call) => workingStepFor(call));

describe("workingStepFor: the same step whatever the engine", () => {
  it("names the script a shell call runs, never its arguments", () => {
    const steps = sameEverywhere([
      { name: "Bash", summary: "python3 scrape.py --token abc", input: JSON.stringify({ command: "python3 scrape.py --token abc" }) },
      { name: "python3 scrape.py --token abc", summary: "python3 scrape.py --token abc" },
      { name: "run_shell_command", input: JSON.stringify({ command: "cd tools && python3 scrape.py" }) },
      { name: "bash", summary: "uv run scrape.py" },
      { name: "run_command", input: JSON.stringify({ command: "python3 ./jobs/scrape.py -v" }) },
    ]);
    for (const step of steps) expect(step).toEqual({ key: "run", detail: "scrape.py" });
  });

  it("names the program of any other command", () => {
    expect(commandStep("cd app && FOO=1 pnpm test --run")).toEqual({ key: "run", detail: "pnpm" });
    expect(commandStep("git status")).toEqual({ key: "run", detail: "git" });
    expect(workingStepFor({ name: "Bash" })).toEqual({ key: "run" });
  });

  it("opens an app, from a shell or a computer tool", () => {
    expect(workingStepFor({ name: "Bash", summary: "open -a \"Google Chrome\" https://example.com" })).toEqual({ key: "openApp", detail: "Google Chrome" });
    expect(workingStepFor({ name: "mcp__computer-use__open_application", input: JSON.stringify({ app: "Chrome" }) })).toEqual({ key: "openApp", detail: "Chrome" });
    expect(workingStepFor({ name: "open_application", input: JSON.stringify({ app: "Chrome" }) })).toEqual({ key: "openApp", detail: "Chrome" });
  });

  it("reads mail, calendar and Teams the same through every connector name", () => {
    for (const name of ["mcp__claude_ai_Microsoft_365__outlook_email_search", "outlook_email_search", "microsoft_365.outlook_email_search", "mcp__gmail__search_threads"]) {
      expect(workingStepFor({ name })).toEqual({ key: "readMail" });
    }
    expect(workingStepFor({ name: "mcp__claude_ai_Microsoft_365__outlook_send_mail" })).toEqual({ key: "writeMail" });
    expect(workingStepFor({ name: "outlook_create_reply_draft" })).toEqual({ key: "writeMail" });
    expect(workingStepFor({ name: "mcp__claude_ai_Microsoft_365__outlook_calendar_search" })).toEqual({ key: "calendar" });
    expect(workingStepFor({ name: "outlook_create_event" })).toEqual({ key: "writeCalendar" });
    expect(workingStepFor({ name: "mcp__claude_ai_Microsoft_365__teams_list_chats" })).toEqual({ key: "readChat", detail: "Teams" });
    expect(workingStepFor({ name: "teams_send_chat_message" })).toEqual({ key: "writeChat", detail: "Teams" });
  });

  it("searches and reads the web", () => {
    for (const name of ["WebSearch", "web_search", "google_web_search", "mcp__brave__brave_search"]) {
      expect(workingStepFor({ name })).toEqual({ key: "searchWeb" });
    }
    expect(workingStepFor({ name: "WebFetch", input: JSON.stringify({ url: "https://www.example.com/a?b=c" }) })).toEqual({ key: "readPage", detail: "example.com" });
    expect(workingStepFor({ name: "web_fetch", input: JSON.stringify({ url: "https://example.com/x" }) })).toEqual({ key: "readPage", detail: "example.com" });
    expect(workingStepFor({ name: "mcp__claude-in-chrome__navigate", input: JSON.stringify({ url: "https://news.example.org/" }) })).toEqual({ key: "browse", detail: "news.example.org" });
    expect(workingStepFor({ name: "browser_click" })).toEqual({ key: "browse" });
  });

  it("names the file a file tool touches, by its name only", () => {
    const reads = sameEverywhere([
      { name: "Read", input: JSON.stringify({ file_path: "/home/me/project/notes.md" }) },
      { name: "read_file", input: JSON.stringify({ path: "project/notes.md" }) },
      { name: "Read project/notes.md" },
      { name: "read", input: JSON.stringify({ path: "C:\\work\\notes.md" }) },
    ]);
    for (const step of reads) expect(step).toEqual({ key: "readFile", detail: "notes.md" });
    expect(workingStepFor({ name: "Write", input: JSON.stringify({ file_path: "/tmp/out/report.csv", content: "a,b" }) })).toEqual({ key: "writeFile", detail: "report.csv" });
    expect(workingStepFor({ name: "edit", input: JSON.stringify([{ path: "src/app.ts", kind: "update" }]) })).toEqual({ key: "editFile", detail: "app.ts" });
    expect(workingStepFor({ name: "Grep" })).toEqual({ key: "searchFiles" });
  });

  it("names the screen, the computer, teammates, sub-agents and memory", () => {
    expect(workingStepFor({ name: "screenshot" })).toEqual({ key: "screen" });
    expect(workingStepFor({ name: "mcp__computer__click" })).toEqual({ key: "computer" });
    expect(workingStepFor({ name: "mcp__agents__ask_bot" })).toEqual({ key: "teammate" });
    expect(workingStepFor({ name: "Agent" })).toEqual({ key: "subagent" });
    expect(workingStepFor({ name: "mcp__agents__memory_save" })).toEqual({ key: "memory" });
  });

  it("names any other connector by its product, and skips bookkeeping", () => {
    expect(workingStepFor({ name: "acme_desk_ticket_get", product: "Acme Desk" })).toEqual({ key: "tool", detail: "Acme Desk" });
    expect(workingStepFor({ name: "mcp__github__create_issue" })).toEqual({ key: "tool", detail: "github" });
    expect(workingStepFor({ name: "make_invoice" })).toEqual({ key: "tool" });
    expect(workingStepFor({ name: "TodoWrite" })).toBeNull();
    expect(workingStepFor({ name: "error: something" })).toBeNull();
  });

  it("never carries a redacted value or a long one", () => {
    expect(workingStepFor({ name: "Read", input: JSON.stringify({ file_path: "[redacted]" }) })).toEqual({ key: "readFile" });
    expect(workingStepFor({ name: "Read", input: JSON.stringify({ file_path: `/x/${"a".repeat(80)}.txt` }) })?.detail?.length).toBeLessThanOrEqual(40);
  });
});

describe("currentWorkingStep", () => {
  const row = (tool: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: "activity", at: 1_000, tool, ...extra });
  it("reads the step of a running call only", () => {
    expect(currentWorkingStep(row({ step: { key: "readMail" } }))).toEqual({ key: "readMail", since: 1_000 });
    expect(currentWorkingStep(row({ ok: true, step: { key: "readMail" } }))).toBeNull();
    expect(currentWorkingStep(row({}))).toBeNull();
    expect(currentWorkingStep(row({ step: { key: "unknown" } }))).toBeNull();
    expect(currentWorkingStep(row({ step: { key: "readMail" } }, { comm: {} }))).toBeNull();
    expect(currentWorkingStep({ kind: "text", at: 1 })).toBeNull();
    expect(currentWorkingStep(undefined)).toBeNull();
  });
});

describe("quietAge", () => {
  it("says nothing for a young step, then minutes, then hours", () => {
    expect(quietAge(0, 59_000)).toBeNull();
    expect(quietAge(0, 125_000)).toEqual({ unit: "min", count: 2 });
    expect(quietAge(0, 2 * 3_600_000 + 5)).toEqual({ unit: "h", count: 2 });
    expect(quietAge(undefined, 1)).toBeNull();
  });
});

describe("shortPathsIn", () => {
  it("keeps only the last two segments of an absolute path in a step line", () => {
    expect(shortPathsIn("cd /workspace/bots/osprey/dispatch-board && pnpm test")).toBe("cd osprey/dispatch-board && pnpm test");
    expect(shortPathsIn("cat /workspace/bots/osprey/dispatch-board/src/column.ts")).toBe("cat src/column.ts");
  });
  it("leaves short paths, relative paths and URLs alone", () => {
    expect(shortPathsIn("ls /tmp")).toBe("ls /tmp");
    expect(shortPathsIn("cat src/board/column.ts")).toBe("cat src/board/column.ts");
    expect(shortPathsIn("open https://example.com/a/b/c")).toBe("open https://example.com/a/b/c");
  });
});
