import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { localVmChoice, localVmDesktopState } from "./local-vm-choice";

const bridge = (online: boolean, localVm: boolean): DesktopBridgeStatus => ({
  connected: online,
  tunnel: false,
  workplace: { place: "computer", network: "all" },
  activity: [],
  desktops: online ? [{
    id: "desk-1", name: "Studio", platform: "darwin", online: true, busy: false, lastSeenAt: 1,
    capabilities: { localVm },
  }] : [],
});

describe("Local VM in the computer picker", () => {
  it("treats a solo server's own Local VM as ready, and an organization desktop by its registration", () => {
    expect(localVmDesktopState(null, false)).toBe("solo");
    expect(localVmDesktopState(null, true)).toBe("unknown");
    expect(localVmDesktopState(bridge(true, true), true)).toBe("ready");
    expect(localVmDesktopState(bridge(true, false), true)).toBe("unregistered");
    expect(localVmDesktopState(bridge(false, true), true)).toBe("offline");
  });

  it("offers a registered Local VM, and hides one that does not exist on a cloud home", () => {
    expect(localVmChoice({ desktop: "ready" })).toEqual({ shown: true, selectable: true, reason: null });
    expect(localVmChoice({ desktop: "solo" })).toEqual({ shown: true, selectable: true, reason: null });
    expect(localVmChoice({ desktop: "unknown" })).toEqual({ shown: true, selectable: true, reason: null });
    expect(localVmChoice({ cloudHome: true, desktop: "ready" })).toEqual({ shown: false, selectable: false, reason: null });
  });

  it("keeps an unavailable Local VM visible and says why", () => {
    expect(localVmChoice({ desktop: "offline" })).toMatchObject({ shown: true, selectable: false });
    expect(localVmChoice({ desktop: "offline" }).reason).toMatch(/not connected/i);
    expect(localVmChoice({ desktop: "unregistered" }).reason).toMatch(/container engine/i);
    expect(localVmChoice({ policyAllows: false, organizationName: "Nimbus" }).reason).toMatch(/Nimbus/);
    expect(localVmChoice({ policyAllows: false }).reason).toMatch(/organization/i);
    expect(localVmChoice({ modelCanUseComputer: false, modelName: "Plain" }).reason).toMatch(/Plain/);
  });
});
