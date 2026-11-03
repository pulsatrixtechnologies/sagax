import { describe, expect, it } from "vitest";

import type { RequestAuth } from "./auth/request-auth.ts";
import {
  SERVICE_VIEWER,
  serviceLoopback,
  servicePathExempt,
  serviceThreadViewer,
  serviceViewerClosed,
} from "./service-viewer.ts";

const service: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

describe("service viewer", () => {
  it("closes a missing viewer only for service loopback on an organization server", () => {
    expect(serviceViewerClosed(service, "/api/bots", true)).toBe(true);
    expect(serviceViewerClosed(service, "/api/internal/act", true)).toBe(false);
    expect(serviceViewerClosed(service, "/api/testing/internal-capability", true)).toBe(false);
    expect(serviceViewerClosed(owner, "/api/bots", true)).toBe(false);
    expect(serviceViewerClosed(service, "/api/bots", false)).toBe(false);
    expect(serviceViewerClosed(service, undefined, true)).toBe(true);
  });

  it("keeps internal and testing paths exempt, and uses a truthy sentinel", () => {
    expect(servicePathExempt("/api/internal/agents")).toBe(true);
    expect(servicePathExempt("/api/internal")).toBe(false);
    expect(servicePathExempt("/api/testing/internal-capability")).toBe(true);
    expect(servicePathExempt("/api/bots")).toBe(false);
    expect(serviceLoopback(service)).toBe(true);
    expect(serviceLoopback(owner)).toBe(false);
    expect(SERVICE_VIEWER).toBe("service:loopback");
    expect(serviceThreadViewer(true, undefined)).toBe("service:loopback");
    expect(serviceThreadViewer(false, undefined)).toBeUndefined();
    expect(serviceThreadViewer(false, "pr_ada")).toBe("pr_ada");
  });
});
