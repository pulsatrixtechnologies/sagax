import { describe, expect, it } from "vitest";

import { askInputDetail, askInputSummary, commandSummary, EDIT_PREVIEW_MAX, inputPreviewMax, toolDetailPreview, toolFailurePreview, toolFailureSource } from "./tool-summary.ts";

describe("toolDetailPreview", () => {
  it("keeps useful input and results while removing nested credentials and binary data", () => {
    const preview = toolDetailPreview({ command: "echo hello", password: "short", headers: { Cookie: "session=private", Authorization: "Bearer secret" }, result: [{ type: "text", text: "hello" }, { type: "image", data: "private-base64" }] });
    expect(preview).toContain("echo hello");
    expect(preview).toContain("hello");
    for (const secret of ["short", "session=private", "Bearer secret", "private-base64"]) expect(preview).not.toContain(secret);
    expect(preview).toContain("[redacted]");
    expect(preview).toContain("[binary content omitted]");
  });
  it("redacts before shortening and bounds recursive or oversized payloads", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const preview = toolDetailPreview(`${"x".repeat(5998)} ${token}`)!;
    expect(preview).not.toContain("ghp_");
    expect(preview).toContain("preview shortened");
    expect(preview.length).toBeLessThan(6050);
    expect(toolDetailPreview("x".repeat(256001))).toBe("[large content omitted]");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(toolDetailPreview(cycle)).toContain("additional data omitted");
    expect(toolDetailPreview(Array.from({ length: 100 }, () => "item"))).toContain("additional items omitted");
    expect(toolDetailPreview({ first: " ".repeat(255_999), second: `ghp_${"a".repeat(36)}` })).not.toContain("ghp_");
    expect(toolDetailPreview({ url: "data:image/png;base64,private-pixels", blob: "more-pixels" })).not.toContain("pixels");
  });
  it("keeps more of a file edit's arguments for the coding chat's diffs, still redacted first", () => {
    expect(inputPreviewMax("Edit")).toBe(EDIT_PREVIEW_MAX);
    expect(inputPreviewMax("mcp__ide__apply_patch")).toBe(EDIT_PREVIEW_MAX);
    expect(inputPreviewMax("Bash")).toBeUndefined();
    const edit = { file_path: "src/a.ts", old_string: "a".repeat(9_000), new_string: `${"b".repeat(9_000)} ghp_${"c".repeat(36)}` };
    const preview = toolDetailPreview(edit, inputPreviewMax("Edit"))!;
    expect(preview).not.toContain("preview shortened");
    expect(preview).not.toContain("ghp_");
    expect(toolDetailPreview(edit)).toContain("preview shortened");
  });
  it("does not invent output and preserves failure text or primitive results", () => {
    expect(toolDetailPreview(undefined)).toBeUndefined();
    expect(toolDetailPreview({})).toBeUndefined();
    expect(toolDetailPreview("permission denied")).toBe("permission denied");
    expect(toolDetailPreview(false)).toBe("false");
    expect(toolDetailPreview({ api_key: 1234 })).not.toContain("1234");
    expect(toolDetailPreview(1234n)).toBe("1234");
  });
  it("scrubs structured JSON inside native text results without changing ordinary prose", () => {
    const preview = toolDetailPreview([{ type: "text", text: JSON.stringify({ message: "request completed", password: "tiny", headers: { Cookie: "sid=x" }, env: [{ name: "API_KEY", value: "small" }] }) }]);
    expect(preview).toContain("request completed");
    for (const secret of ["tiny", "sid=x", "small"]) expect(preview).not.toContain(secret);
    expect(toolDetailPreview("[1,2 invalid json")).toBe("[1,2 invalid json");
    expect(toolDetailPreview("plain output\nsecond line")).toBe("plain output\nsecond line");
  });
});

describe("commandSummary", () => {
  it("is the shell command, cut at 200", () => {
    expect(commandSummary({ command: "pnpm control:omb doctor --url http://127.0.0.1:1", url: "x" }))
      .toBe("pnpm control:omb doctor --url http://127.0.0.1:1");
    expect(commandSummary({ command: "x".repeat(260) })).toBe("x".repeat(200));
  });

  it("says nothing for a call that runs no command — a Read, an Edit, a fetch", () => {
    expect(commandSummary({ file_path: "/tmp/notes.md" })).toBeUndefined();
    expect(commandSummary({ file_path: "scripts/control-omb.ts", old_string: "a", new_string: "b" })).toBeUndefined();
    expect(commandSummary({ url: "https://example.com/docs" })).toBeUndefined();
    expect(commandSummary({ question: "Which one?" })).toBeUndefined();
    expect(commandSummary({})).toBeUndefined();
    expect(commandSummary(undefined)).toBeUndefined();
    expect(commandSummary(null)).toBeUndefined();
    expect(commandSummary("ls")).toBeUndefined();
    expect(commandSummary(["ls"])).toBeUndefined();
  });

  it("collapses a multi-line command onto one line", () => {
    expect(commandSummary({ command: "cd repo &&\n  pnpm test \\\n  --run" })).toBe("cd repo && pnpm test \\ --run");
  });

  it("redacts credentials before cutting, so a sliced key cannot slip through", () => {
    // the token starts at column 186: cutting first would leave "ghp_" plus
    // ten characters — too short for the github shape to catch
    const token = `ghp_${"a".repeat(36)}`;
    const summary = commandSummary({ command: `${"x".repeat(180)} curl ${token} https://api` });
    expect(summary).not.toContain("ghp_");
    expect(summary).toContain("«redacted 40 chars»".slice(0, 14));
    expect(summary!.length).toBeLessThanOrEqual(200);
  });
});

describe("askInputSummary", () => {
  it("prefers a question, at its longer limit", () => {
    const question = "Which of these should I keep? ".repeat(12);
    expect(askInputSummary({ question, command: "ls" })).toBe(question.trim());
  });

  it("keeps a multi-line command multi-line — the card shows it as it will run", () => {
    expect(askInputSummary({ command: "cd repo &&\n  pnpm test \\\n  --run" })).toBe("cd repo &&\n  pnpm test \\\n  --run");
    expect(askInputSummary({ command: "x".repeat(260) })).toBe("x".repeat(200));
  });

  it("falls back to a url, then to the arguments as JSON, then to nothing", () => {
    expect(askInputSummary({ url: "https://example.com/docs" })).toBe("https://example.com/docs");
    expect(askInputSummary({ file_path: "/tmp/notes.md" })).toBe('{"file_path":"/tmp/notes.md"}');
    expect(askInputSummary({})).toBeUndefined();
    expect(askInputSummary(undefined)).toBeUndefined();
    expect(askInputSummary(["ls"])).toBeUndefined();
  });

  it("redacts a key in a url", () => {
    expect(askInputSummary({ url: `https://h/?api_key=${"k".repeat(24)}` })).toBe("https://h/?api_key=«redacted 24 chars»");
  });
});

describe("askInputDetail", () => {
  it("keeps the full arguments as valid, redacted JSON for the card's technical details", () => {
    const conditions = `member/identifier='amartin' and dateStart >= [2026-10-02T04:00:00Z] ${"x".repeat(300)}`;
    const text = askInputDetail({ conditions, apiKey: "sk-live-secret-value", pageSize: 100 });
    const parsed = JSON.parse(text!);
    expect(parsed.conditions).toBe(conditions);
    expect(parsed.pageSize).toBe(100);
    expect(text).not.toContain("sk-live-secret-value");
  });

  it("is undefined when there is nothing to show", () => {
    expect(askInputDetail({})).toBeUndefined();
    expect(askInputDetail(undefined)).toBeUndefined();
    expect(askInputDetail("text")).toBeUndefined();
  });
});

describe("toolFailurePreview", () => {
  it("is the failure's own words, redacted", () => {
    const key = "sk-ant-api03-" + "a".repeat(80);
    const text = toolFailurePreview({ content: [{ type: "text", text: `upstream refused key ${key}` }], isError: true });
    expect(text).toMatch(/^upstream refused key /);
    expect(text).not.toContain(key);
  });

  it("falls back to the preview when the failure has no words", () => {
    expect(toolFailurePreview({ output: null, exitCode: 2 })).toContain("exitCode");
    expect(toolFailurePreview(undefined)).toBeUndefined();
  });
});

describe("toolFailureSource (#1988)", () => {
  const body = {
    code: "params_invalid",
    details: { status: 400 },
    hint: "call flow_run with {\"command\": \"run.finish\"}",
    message: "flow_run read only runs read commands, and `run close` is not one: call flow_run {\"command\": \"run.finish\"} instead",
  };
  const result = { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, _meta: null };

  it("keeps a Codex mcpToolCall result when error is null, empty, or wordless", () => {
    for (const error of [null, undefined, "", {}, { code: "params_invalid" }]) {
      const text = toolFailurePreview(toolFailureSource(error, result));
      expect(text).toContain("call flow_run {\"command\": \"run.finish\"} instead (params_invalid)");
      expect(text).toContain("call flow_run with");
    }
  });

  it("prefers an error that already has words", () => {
    expect(toolFailurePreview(toolFailureSource({ message: "HTTP 401 Unauthorized" }, result))).toBe("HTTP 401 Unauthorized");
  });

  it("does not let error ?? result hide the server's message behind an empty error", () => {
    // the old Codex path: empty error won over result (`??` keeps "" / {}) and the card had no words
    const oldSource = (error: unknown, value: unknown) => (error !== undefined && error !== null ? error : value);
    expect(toolFailurePreview(oldSource("", result))).toBeUndefined();
    expect(toolFailurePreview(oldSource({}, result))).toBeUndefined();
    expect(toolFailurePreview(toolFailureSource("", result))).toContain("params_invalid");
    expect(toolFailurePreview(toolFailureSource({}, result))).toContain("params_invalid");
  });
});
