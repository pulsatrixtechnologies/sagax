// #4360: « Check routine » on a real server without an organization. It never
// claims an organization connection, and it checks the routine's own trigger.
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";

it("checks what a solo routine needs, never an organization connection (#4360)", async () => {
  const fixture = await launchVerificationServer(process.env);
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBeLessThan(300);
    return value;
  };
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Solo check", "--url", fixture.info.url]) as any;
    const daily = (await api("POST", "/api/routines", { name: "Morning", prompt: "Summarize my day.", botId: bot.id, runOn: "maus", enabled: true,
      schedule: { type: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] } })).routine;
    const clock = await api("POST", `/api/routines/${daily.id}/check`);
    const kinds = clock.checks.map((check: any) => check.kind);
    expect(kinds).toContain("engine");
    expect(kinds).not.toContain("perspicax");
    expect(kinds).not.toContain("triggers");
    expect(JSON.stringify(clock)).not.toMatch(/Perspicax/);
    const hook = (await api("POST", "/api/routines", { name: "On deploy", prompt: "Read the deploy note.", botId: bot.id, runOn: "maus", enabled: true,
      schedule: { type: "webhook" } })).routine;
    const triggered = await api("POST", `/api/routines/${hook.id}/check`);
    expect(triggered.checks.map((check: any) => check.kind)).not.toContain("perspicax");
    expect(triggered.checks.find((check: any) => check.kind === "triggers")).toMatchObject({ ok: true, code: "ready" });
  } finally {
    await fixture.close();
  }
}, 120_000);
