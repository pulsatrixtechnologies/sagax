// 2026-10-20: every 401 for a presented session and every session ended is
// one diagnosable log line, never a secret.
import { describe, expect, it } from "vitest";

import { clientFamily, createAuthRefusalLogger, loggablePath, sessionIdPrefix } from "./auth-refusal-log.ts";

describe("auth refusal log", () => {
  it("says the reason, route, client family and session prefix; never a query, a token or a cookie", () => {
    const lines: string[] = [];
    const logger = createAuthRefusalLogger({ log: (line) => lines.push(line), now: () => 0 });
    logger.record({ event: "refused", status: 401, code: "session_unknown", method: "get", path: "/api/events?ticket=sgx_secret", via: "ticket", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", sessionId: "0f8a1c2e-1111-2222-3333-444455556666" });
    expect(lines).toEqual(["auth: session refused status=401 code=session_unknown route=GET /api/events via=ticket client=browser-ios session=0f8a1c2e"]);
    expect(lines[0]).not.toContain("sgx_secret");
  });

  it("writes a repeated refusal once a minute, then how many it held back", () => {
    let clock = 0;
    const lines: string[] = [];
    const logger = createAuthRefusalLogger({ log: (line) => lines.push(line), now: () => clock });
    const event = { event: "refused" as const, status: 401, code: "session_revoked", method: "GET", path: "/api/auth/session", via: "cookie", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sagax/0.5.25 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36" };
    for (let i = 0; i < 24; i++) { logger.record(event); clock += 2_500; }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("client=desktop-windows");
    clock = 60_001;
    logger.record(event);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/repeated=2[34]$/);
    // an ended session is always written
    logger.record({ event: "ended", status: 401, code: "idp_session_ended", method: "GET", path: "/api/bots", detail: 'a "quoted"\nreason' });
    logger.record({ event: "ended", status: 401, code: "idp_session_ended", method: "GET", path: "/api/bots", detail: 'a "quoted"\nreason' });
    expect(lines.filter((line) => line.startsWith("auth: session ended"))).toHaveLength(2);
    expect(lines.at(-1)).toContain('detail="a  quoted  reason"');
  });

  it("names client families coarsely", () => {
    expect(clientFamily(undefined)).toBe("none");
    expect(clientFamily("Sagax/52 CFNetwork/1568.100.1 Darwin/24.0.0")).toBe("ios-app");
    expect(clientFamily("okhttp/4.12.0")).toBe("android-app");
    expect(clientFamily("node")).toBe("node");
    expect(clientFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Electron/33.0.0 Safari/537.36")).toBe("desktop-mac");
    expect(sessionIdPrefix(undefined)).toBe("-");
    expect(loggablePath("/api/x?y=1")).toBe("/api/x");
  });

  it("caps refusal lines and groups unknown tokens without their route", () => {
    const lines: string[] = [];
    const logger = createAuthRefusalLogger({ log: (line) => lines.push(line), now: () => 0 });
    for (let i = 0; i < 500; i++) logger.record({ event: "refused", status: 401, code: "session_unknown", method: "GET", path: `/api/x${i}`, via: "bearer", userAgent: "curl/8" });
    expect(lines).toHaveLength(1);
    for (let i = 0; i < 500; i++) logger.record({ event: "refused", status: 401, code: "session_revoked", method: "GET", path: `/api/x${i}`, via: "bearer", sessionId: "abcdef12-x" });
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});
