// host_computer exec answers for the bot (#3393): only a real run reads as
// "exit code N"; an answer without an exit code is an error saying the
// command did not run, and the label always names a host.
import { describe, expect, it } from "vitest";

import { callComputersTool, hostExecResult } from "./computers.ts";
import type { ToolCallContext } from "../agents-call-types.ts";

function contextAnswering(body: Record<string, unknown>, status = 200): ToolCallContext {
  const apiResponse = async () => ({ ok: status < 400, status, body });
  return { client: { api: async () => body, apiResponse } } as unknown as ToolCallContext;
}

describe("host_computer exec answer", () => {
  it("a real run names the host and its OS", () => {
    const out = hostExecResult(JSON.stringify({ where: "DEVJC-FS-01", os: "Linux", exitCode: 0, timedOut: false, stdout: "ok\n", stderr: "" }), "DEVJC-FS-01", false);
    expect(out.isError).toBeUndefined();
    expect(out.text.split("\n")[0]).toBe("DEVJC-FS-01 (Linux): exit code 0");
  });

  it("an answer without an exit code is an error, never exit code 0", async () => {
    for (const text of ["{}", "0", "[]"]) {
      const out = await callComputersTool("host_computer", { action: "exec", command: "uname -a", host: "DEVJC-FS-01" }, contextAnswering({ text }));
      expect(out?.isError).toBe(true);
      expect(out?.text).toMatch(/^The command did not run on DEVJC-FS-01: /);
      expect(out?.text).not.toMatch(/exit code 0|\(no output\)|\(\)/);
    }
  });

  it("an empty answer is an error naming the host asked for", async () => {
    const out = await callComputersTool("host_computer", { action: "exec", command: "ls", host: "DEVJC-FS-01" }, contextAnswering({}));
    expect(out?.isError).toBe(true);
    expect(out?.text).toMatch(/^The command did not run on DEVJC-FS-01: /);
  });

  it("a refusal sentence stays the bot's reason", async () => {
    const out = await callComputersTool("host_computer", { action: "exec", command: "ls", host: "DEVJC-FS-01" }, contextAnswering({ text: "DEVJC-FS-01 is offline. It works again once it is back online.", isError: true }));
    expect(out).toEqual({ text: "DEVJC-FS-01 is offline. It works again once it is back online.", isError: true });
  });

  it("a run without a host name in the answer is labelled with the host asked for", () => {
    const out = hostExecResult(JSON.stringify({ exitCode: 2, timedOut: false, stdout: "", stderr: "no such file" }), "DEVJC-FS-01", false);
    expect(out.isError).toBe(true);
    expect(out.text.split("\n")[0]).toBe("DEVJC-FS-01: exit code 2");
  });
});
