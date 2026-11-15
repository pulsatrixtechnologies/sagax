// #4360: the one "alone on the server" test (src/lib/server-alone.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  org: null as unknown,
  invites: null as unknown,
  invitesStatus: 200,
  calls: [] as string[],
}));

vi.mock("@/lib/perspicax-org", () => ({ loadPerspicaxOrg: async () => fixture.org }));
vi.mock("@/state/store", async () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  }
  return {
    ApiError,
    api: async (path: string) => {
      fixture.calls.push(path);
      if (fixture.invitesStatus !== 200) throw new ApiError("refused", fixture.invitesStatus);
      return fixture.invites;
    },
  };
});

import { directoryAlone, knownServerAlone, loadServerAlone, resetServerAlone } from "./server-alone";

const owner = { id: "p_owner", role: "owner" };
const guest = { id: "guest@example.test", role: "member" };

beforeEach(() => {
  fixture.org = null;
  fixture.invites = { people: [owner], pendingInvites: [] };
  fixture.invitesStatus = 200;
  fixture.calls = [];
  resetServerAlone();
});
afterEach(() => resetServerAlone());

describe("server alone (#4360)", () => {
  it("is alone with only the owner and no invitation waiting", async () => {
    expect(await loadServerAlone(true)).toBe(true);
    expect(knownServerAlone()).toBe(true);
    expect(fixture.calls).toEqual(["/api/org/invites"]);
  });

  it("is not alone once the server has another person, or an invitation waits", async () => {
    fixture.invites = { people: [owner, guest], pendingInvites: [] };
    expect(await loadServerAlone(true)).toBe(false);
    fixture.invites = { people: [owner], pendingInvites: [{ email: "next@example.test" }] };
    expect(await loadServerAlone(true)).toBe(false);
  });

  it("is alone on a server with no sign-in directory at all", async () => {
    fixture.invitesStatus = 404;
    expect(await loadServerAlone(true)).toBe(true);
  });

  it("keeps the wording with people on any other refusal", async () => {
    fixture.invitesStatus = 500;
    expect(await loadServerAlone(true)).toBe(false);
  });

  it("is never alone on an organization server, and asks nothing more", async () => {
    fixture.org = { org: { identity: { kind: "perspicax" } } };
    expect(await loadServerAlone(true)).toBe(false);
    expect(fixture.calls).toEqual([]);
  });

  it("is not alone when someone else runs the server", async () => {
    expect(await loadServerAlone(false)).toBe(false);
    expect(fixture.calls).toEqual([]);
  });

  it("reads the directory rule the same everywhere", () => {
    expect(directoryAlone({ people: [owner], pendingInvites: [] })).toBe(true);
    expect(directoryAlone({ people: [], pendingInvites: [] })).toBe(true);
    expect(directoryAlone({ people: [owner, guest], pendingInvites: [] })).toBe(false);
  });
});
