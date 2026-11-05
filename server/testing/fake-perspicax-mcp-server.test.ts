import { afterEach, describe, expect, it } from "vitest";
import {
  callFakePerspicax,
  startFakePerspicaxMcp,
  type FakePerspicaxMcp,
} from "./fake-perspicax-mcp-server.ts";

const open: FakePerspicaxMcp[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function connect(mcp: FakePerspicaxMcp, profileId = "pf-dispatch", botId = "osprey") {
  const init = await callFakePerspicax(mcp.url, "initialize", {}, { profileId, botId });
  expect(init.sessionId).toBeTruthy();
  await callFakePerspicax(mcp.url, "notifications/initialized", {}, { id: init.sessionId!, profileId, botId });
  return init.sessionId!;
}

async function flow(mcp: FakePerspicaxMcp, sessionId: string, command: string, args: Record<string, unknown> = {}, profileId = "pf-dispatch") {
  const answered = await callFakePerspicax(
    mcp.url,
    "tools/call",
    { name: "flow_run", arguments: { command, args } },
    { id: sessionId, profileId, botId: "osprey" },
  );
  return (answered.result as { structuredContent?: unknown; isError?: boolean }) ?? {};
}

describe("fake Perspicax MCP server-mode contract (#2006)", () => {
  it("lists tools per role", async () => {
    const mcp = await startFakePerspicaxMcp();
    open.push(mcp);
    const dispatch = await connect(mcp, "pf-dispatch");
    const listed = await callFakePerspicax(mcp.url, "tools/list", {}, { id: dispatch, profileId: "pf-dispatch", botId: "osprey" });
    const names = ((listed.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["identity_switch", "flow_run", "cw_psa_query"]));
    expect(names).not.toContain("cw_psa_finance_invoices_write");

    const invoices = await connect(mcp, "pf-invoices", "wren");
    const invoiceTools = await callFakePerspicax(mcp.url, "tools/list", {}, { id: invoices, profileId: "pf-invoices", botId: "wren" });
    expect(((invoiceTools.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name))
      .toEqual(expect.arrayContaining(["cw_psa_finance_invoices_query", "cw_psa_finance_invoices_write"]));
  });

  it("runs run.init by name with server_profiles, plan with inline JSON, and run.finish", async () => {
    const mcp = await startFakePerspicaxMcp();
    open.push(mcp);
    const sessionId = await connect(mcp);
    const init = await flow(mcp, sessionId, "run.init", { routine: "morning-dispatch" });
    expect(init.structuredContent).toMatchObject({ status: "ok", run_id: expect.any(String) });
    const runId = (init.structuredContent as { run_id: string }).run_id;
    expect(mcp.leases()).toHaveLength(1);

    const plan = await flow(mcp, sessionId, "plan", {
      run_id: runId,
      units: [{ id: 42 }],
      since: "2026-11-04T10:00:00Z",
      reads: ["cw_psa_query"],
    });
    expect(plan.structuredContent).toMatchObject({ status: "ok" });

    const finished = await flow(mcp, sessionId, "run.finish", { run_id: runId });
    expect(finished.structuredContent).toMatchObject({ status: "ok" });
    expect(mcp.leases()).toHaveLength(0);
    expect(mcp.calls.map((call) => call.command)).toEqual(["run.init", "plan", "run.finish"]);
  });

  it("refuses a routine that does not declare the profile in server_profiles", async () => {
    const mcp = await startFakePerspicaxMcp();
    open.push(mcp);
    const sessionId = await connect(mcp, "pf-invoices");
    const init = await flow(mcp, sessionId, "run.init", { routine: "morning-dispatch" }, "pf-invoices");
    expect(init.isError).toBe(true);
    expect(init.structuredContent).toMatchObject({
      output: expect.objectContaining({ error: "routine_not_for_profile" }),
    });
    expect(mcp.leases()).toHaveLength(0);
  });

  it("holds one lease per routine and reports already_running on a second init", async () => {
    const mcp = await startFakePerspicaxMcp();
    open.push(mcp);
    const first = await connect(mcp, "pf-dispatch", "osprey");
    await flow(mcp, first, "run.init", { routine: "morning-dispatch" });
    const second = await connect(mcp, "pf-dispatch", "wren");
    const blocked = await flow(mcp, second, "run.init", { routine: "morning-dispatch" });
    expect(blocked.structuredContent).toMatchObject({ status: "blocked", reason: "already_running" });
    expect(mcp.leases()).toHaveLength(1);
  });

  it("answers identity_switch and a 403 on a forbidden write", async () => {
    const mcp = await startFakePerspicaxMcp({
      writeForbidden: { calendar_events_write: "locked by another person" },
    });
    open.push(mcp);
    const sessionId = await connect(mcp, "pf-meetings");
    const switched = await callFakePerspicax(
      mcp.url,
      "tools/call",
      { name: "identity_switch", arguments: { profile: "meetings-agent" } },
      { id: sessionId, profileId: "pf-meetings", botId: "osprey" },
    );
    expect((switched.result as { structuredContent: { acting_as: { slug: string } } }).structuredContent.acting_as.slug)
      .toBe("meetings-agent");

    const write = await callFakePerspicax(
      mcp.url,
      "tools/call",
      { name: "calendar_events_write", arguments: { id: 10 } },
      { id: sessionId, profileId: "pf-meetings", botId: "osprey" },
    );
    expect((write.result as { isError?: boolean; structuredContent: { status: number } }).isError).toBe(true);
    expect((write.result as { structuredContent: { status: number } }).structuredContent.status).toBe(403);
  });

  it("fails plan with missing_reads when the allowlist is checked and empty", async () => {
    const mcp = await startFakePerspicaxMcp();
    open.push(mcp);
    const sessionId = await connect(mcp);
    const init = await flow(mcp, sessionId, "run.init", { routine: "morning-dispatch" });
    const runId = (init.structuredContent as { run_id: string }).run_id;
    const plan = await flow(mcp, sessionId, "plan", { run_id: runId, check: true, units: [{ id: 1 }] });
    expect(plan.isError).toBe(true);
    expect(plan.structuredContent).toMatchObject({
      output: expect.objectContaining({ error: "missing_reads" }),
    });
  });

  it("releases a shadow lease without business finish", async () => {
    const mcp = await startFakePerspicaxMcp();
    open.push(mcp);
    const init = await callFakePerspicax(mcp.url, "initialize", {}, { profileId: "account", botId: "osprey" });
    const sessionId = init.sessionId!;
    await callFakePerspicax(mcp.url, "notifications/initialized", {}, { id: sessionId, profileId: "account", botId: "osprey" });
    // Override clientInfo shape used by readiness probes.
    const shadow = await callFakePerspicax(
      mcp.url,
      "tools/call",
      { name: "flow_run", arguments: { command: "run.init", args: { shadow: true, routine: "morning-dispatch" } } },
      { id: sessionId, profileId: "account", botId: "osprey" },
    );
    const runId = (shadow.result as { structuredContent: { run_id: string } }).structuredContent.run_id;
    expect(mcp.leases()).toHaveLength(1);
    const released = await callFakePerspicax(
      mcp.url,
      "tools/call",
      { name: "flow_run", arguments: { command: "release", args: { routine: "morning-dispatch", run_id: runId } } },
      { id: sessionId, profileId: "account", botId: "osprey" },
    );
    expect((released.result as { structuredContent: { status: string } }).structuredContent.status).toBe("ok");
    expect(mcp.leases()).toHaveLength(0);
  });
});
