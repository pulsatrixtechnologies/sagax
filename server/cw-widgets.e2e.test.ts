import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { FIXTURE_TICKETS, fixtureQueryResult } from "../shared/cw-widgets/fixtures.ts";
import type { WireMessage } from "../shared/wire.ts";

// Mocked ConnectWise only: the fake engine "calls" cw_psa__query and the
// Perspicax view tool cw_psa__show_tickets and hands back made-up records.
// Nothing reaches a ConnectWise server. Only the view tool draws a widget
// (vues CW seulement sur demande, 2026-10-20).
it("turns a ConnectWise query into a widget and a widget change into an approval card", async () => {
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([{
      name: "mcp__perspicax_x__cw_psa__query",
      input: { resource: "service/tickets", conditions: "closedFlag=false" },
      output: [{ type: "text", text: fixtureQueryResult(FIXTURE_TICKETS.slice(0, 3), 41) }],
      ok: true,
    }, {
      name: "mcp__perspicax_x__cw_psa__show_tickets",
      input: { resource: "service/tickets", conditions: "closedFlag=false" },
      output: [{ type: "text", text: fixtureQueryResult(FIXTURE_TICKETS.slice(0, 3), 41) }],
      ok: true,
    }]),
  });
  const control = async (args: string[]) => await runControlOmb([...args, "--url", fixture.info.url]) as any;
  const api = async (path: string, init?: { method?: string; body?: unknown }) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? {} : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const messages = async (threadId: string): Promise<WireMessage[]> =>
    (await api(`/api/threads/${threadId}/messages?limit=80`)).body.messages;
  try {
    const bot = (await control(["new-bot", "--name", "Répartiteur"])).bot;
    const threadId: string = bot.activeTaskId;
    await control(["send", "--bot", bot.id, "--text", "Montre-moi les billets ouverts en tableau interactif"]);
    expect((await control(["wait", "--bot", bot.id, "--timeout", "20"])).status).toBe("settled");

    const rows = await messages(threadId);
    const query = rows.find((row) => row.tool?.name?.endsWith("cw_psa__query"));
    expect(query).toBeTruthy();
    expect(query?.tool?.widget).toBeUndefined();
    const tool = rows.find((row) => row.tool?.widget);
    expect(tool?.tool?.name).toMatch(/cw_psa__show_tickets$/);
    const widget = tool?.tool?.widget as any;
    expect(widget).toMatchObject({ family: "ticket", view: "list", total: 41 });
    expect(widget.records.map((row: { id: number }) => row.id)).toEqual([48213, 48197, 48150]);
    expect(widget.records[0].link).toMatch(/^https:\/\/na\.myconnectwise\.net\/v4_6_release\/services\/system_io\/router\/openrecord\.rails\?recordType=ServiceFv&recid=48213/);
    const log = readFileSync(join(fixture.info.dataDir, "events", `${threadId}.ndjson`), "utf8");
    expect(log).not.toContain("resultText");

    expect((await api(`/api/threads/${threadId}/cw-actions`, { method: "POST", body: { action: { kind: "ticket.delete", ticketId: 1 } } })).status).toBe(400);
    const asked = await api(`/api/threads/${threadId}/cw-actions`, {
      method: "POST",
      body: { action: { kind: "ticket.status", ticketId: 48213, status: "Résolu", from: "En cours" } },
    });
    expect(asked.status).toBe(201);
    const card = (await messages(threadId)).find((row) => row.card?.requestId === asked.body.requestId)?.card;
    expect(card).toMatchObject({ requestType: "permission", tool: "cw_psa__write", options: ["Allow", "Deny"] });
    expect(card?.cwActionRequest?.action).toEqual({ kind: "ticket.status", ticketId: 48213, status: "Résolu", from: "En cours" });

    const allowed = await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: asked.body.requestId, behavior: "allow" } });
    expect(allowed).toMatchObject({ status: 200, body: { outcome: "allowed-once" } });
    expect((await control(["wait", "--bot", bot.id, "--timeout", "20"])).status).toBe("settled");
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
    expect(JSON.stringify(dump.prompt)).toContain("service/tickets/48213");
    expect(JSON.stringify(dump.prompt)).toContain("cw_psa__write");
    const settled = (await messages(threadId)).find((row) => row.card?.requestId === asked.body.requestId)?.card;
    expect(settled?.answered).toBe("allow");
    expect((await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: asked.body.requestId, behavior: "allow" } })).status).toBe(409);

    const before = (await messages(threadId)).filter((row) => row.role === "user").length;
    const note = await api(`/api/threads/${threadId}/cw-actions`, {
      method: "POST",
      body: { action: { kind: "ticket.note", ticketId: 48150, text: "Accès VPN créé.", internal: true } },
    });
    expect(note.status).toBe(201);
    const denied = await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: note.body.requestId, behavior: "deny" } });
    expect(denied).toMatchObject({ status: 200, body: { outcome: "rejected" } });
    const after = await messages(threadId);
    expect(after.find((row) => row.card?.requestId === note.body.requestId)?.card?.answered).toBe("deny");
    expect(after.filter((row) => row.role === "user").length).toBe(before);

    // 2026-10-19 (JC: "Toujours permettre" on every card): a widget's card
    // offers Always allow for this bot and this kind of change; kept, the
    // next status change of a ticket asks nothing; a note keeps its card;
    // revoked, the card comes back
    const status = (ticketId: number) => api(`/api/threads/${threadId}/cw-actions`, {
      method: "POST", body: { action: { kind: "ticket.status", ticketId, status: "Résolu", from: "En cours" } },
    });
    const kept = await status(48197);
    const keptCard = (await messages(threadId)).find((row) => row.card?.requestId === kept.body.requestId)?.card;
    expect(keptCard?.ownerRule).toMatchObject({ tool: "cw_widget:cw_psa__write" });
    expect(keptCard?.ownerRule?.scope).not.toHaveProperty("id");
    expect((await api(`/api/threads/${threadId}/respond`, { method: "POST", body: { requestId: kept.body.requestId, behavior: "allow", rule: "allow" } })).status).toBe(200);
    expect((await control(["wait", "--bot", bot.id, "--timeout", "20"])).status).toBe("settled");
    const rules = (await api("/api/approval-rules")).body.rules as Array<{ id: string; tool: string }>;
    const rule = rules.find((row) => row.tool === "cw_widget:cw_psa__write");
    expect(rule).toBeTruthy();
    const byRule = await status(48150);
    expect(byRule).toMatchObject({ status: 201, body: { allowedByRule: true } });
    expect((await messages(threadId)).find((row) => row.card?.requestId === byRule.body.requestId)?.card?.answered).toBe("allow");
    expect((await control(["wait", "--bot", bot.id, "--timeout", "20"])).status).toBe("settled");
    const noteAgain = await api(`/api/threads/${threadId}/cw-actions`, {
      method: "POST", body: { action: { kind: "ticket.note", ticketId: 48150, text: "Suivi.", internal: true } },
    });
    expect(noteAgain.body.allowedByRule).toBeUndefined();
    expect((await api(`/api/approval-rules/${rule!.id}`, { method: "DELETE" })).status).toBe(200);
    const revoked = await status(48213);
    expect(revoked.body.allowedByRule).toBeUndefined();
    expect((await messages(threadId)).find((row) => row.card?.requestId === revoked.body.requestId)?.card?.answered).toBeUndefined();
  } finally {
    await fixture.close();
    expect(existsSync(fixture.info.dataDir)).toBe(false);
  }
}, 90_000);
