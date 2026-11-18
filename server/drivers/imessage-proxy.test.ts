import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGES_PROXY_TIMEOUT_MS, forwardMessagesCall, messagesCallApp } from "./imessage-proxy.ts";

const env = { SAGAX_HARNESS_URL: "http://127.0.0.1:4000", SAGAX_MESSAGES_TOKEN: "turn-token" } as NodeJS.ProcessEnv;

async function answer(name: string, fetchImpl: typeof fetch): Promise<{ result?: { content?: Array<{ text: string }>; isError?: boolean } }> {
  const lines: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { lines.push(String(chunk)); return true; });
  try {
    await forwardMessagesCall({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: {} } }, env, fetchImpl);
  } finally {
    write.mockRestore();
  }
  return JSON.parse(lines.join("").trim());
}

afterEach(() => vi.restoreAllMocks());

describe("imessage proxy", () => {
  // 2026-11-17: a Mail read the Mac answered after 30 s came back as
  // "Messages could not be reached. Nothing was sent." (wrong app, no reason).
  it("waits longer than the desktop bridge gives a Mac call", () => {
    expect(MESSAGES_PROXY_TIMEOUT_MS).toBeGreaterThan(180_000);
  });

  it("names the app of the call and why it got no answer", async () => {
    const timedOut = await answer("mac_mail_list_mailboxes", (async () => { throw new DOMException("timed out", "TimeoutError"); }) as never);
    expect(timedOut.result?.isError).toBe(true);
    expect(timedOut.result?.content?.[0]?.text).toMatch(/^Mail on your Mac did not answer within 12 minutes/);
    const refused = await answer("mac_calendar_list", (async () => new Response(JSON.stringify({ error: "this internal capability cannot access that service" }), { status: 403 })) as never);
    expect(refused.result?.content?.[0]?.text).toBe("Calendar on your Mac could not be used: the Sagax server answered HTTP 403 (this internal capability cannot access that service). Nothing was done.");
    const down = await answer("mac_notes_search", (async () => { throw new TypeError("fetch failed"); }) as never);
    expect(down.result?.content?.[0]?.text).toMatch(/^Notes on your Mac could not be reached: the connection to the Sagax server failed \(fetch failed\)/);
  });

  it("passes the server's own answer through, error words included", async () => {
    const result = { content: [{ type: "text", text: "Mail did not answer within 60 s." }], isError: true };
    const passed = await answer("mac_mail_search", (async () => new Response(JSON.stringify({ result }), { status: 200 })) as never);
    expect(passed.result).toEqual(result);
  });

  it("reads each Apple app by its tool, Messages for the older names", () => {
    expect(["mac_mail_search", "mac_calendar_list", "mac_contacts_search", "mac_reminders_complete", "mac_notes_search", "mac_messages_send", "send_message"].map((name) => messagesCallApp({ name })))
      .toEqual(["Mail", "Calendar", "Contacts", "Reminders", "Notes", "Messages", "Messages"]);
  });
});
