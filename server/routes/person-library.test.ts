import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../auth/request-auth.ts";
import type { ThreadFile } from "../threads/thread-files.ts";
import { createPersonLibraryRoutes, roomsInCommon, type PersonLibraryRoom } from "./person-library.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

const ROOMS: PersonLibraryRoom[] = [
  { id: "ops", name: "Operations", threadId: "t-ops", humanIds: ["pr_me", "pr_ada"] },
  { id: "dm", name: "Me, Ada", threadId: "t-dm", humanIds: ["pr_me", "pr_ada"], peopleDm: true },
  { id: "theirs", name: "Ada and Bob", threadId: "t-theirs", humanIds: ["pr_ada", "pr_bob"] },
  { id: "mine", name: "Me alone", threadId: "t-mine", humanIds: ["pr_me"] },
  { id: "hidden", name: "Left room", threadId: "t-hidden", humanIds: ["pr_me", "pr_ada"] },
  { id: "old", name: "Archived", threadId: "t-old", humanIds: ["pr_me", "pr_ada"], archivedAt: 1 },
];

const file = (threadId: string, at: number, name: string): ThreadFile => ({
  id: threadId.replace(/[^a-f0-9]/g, "a").padEnd(24, "0").slice(0, 24), messageId: "m", source: "upload", path: `/x/${name}`, name, at, size: 1, available: true,
});

const FILES: Record<string, ThreadFile[]> = {
  "t-ops": [file("t-ops", 3, "plan.pdf")],
  "t-ops-2": [file("t-ops-2", 5, "notes.txt")],
  "t-dm": [file("t-dm", 4, "photo.png")],
  "t-theirs": [file("t-theirs", 9, "secret.pdf")],
  "t-mine": [file("t-mine", 9, "mine.pdf")],
  "t-hidden": [file("t-hidden", 9, "hidden.pdf")],
  "t-old": [file("t-old", 9, "old.pdf")],
};

const member = (who: string): RequestAuth => ({
  kind: "session", via: "bearer", scopes: ["client"],
  session: { id: who, label: who, scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0, principalId: who } as never,
});

async function serve(auth: RequestAuth): Promise<string> {
  const routes = [createPersonLibraryRoutes<PersonLibraryRoom>({
    viewerId: (caller) => (caller.kind === "session" ? (caller.session as { principalId?: string }).principalId : undefined),
    groups: () => ROOMS,
    visible: (group) => group.id !== "hidden",
    threadsOf: (group) => (group.id === "ops" ? ["t-ops", "t-ops-2"] : [group.threadId]),
    files: async (threadId) => FILES[threadId] ?? [],
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline" });
    } catch (error) { json(res, 500, { error: String(error) }); }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("person library route", () => {
  it("is member scope", () => {
    expect(requiredScope("GET", "/api/people/pr_ada/library")).toBe("client");
  });

  it("lists the files of the rooms both people are in that the viewer reads, newest first, each with its conversation", async () => {
    const base = await serve(member("pr_me"));
    const body = await (await fetch(`${base}/api/people/pr_ada/library`)).json() as { files: Array<{ name: string; threadId: string; groupName: string }> };
    expect(body.files.map((entry) => entry.name)).toEqual(["notes.txt", "photo.png", "plan.pdf"]);
    expect(body.files.map((entry) => entry.threadId)).toEqual(["t-ops-2", "t-dm", "t-ops"]);
    expect(body.files[1]!.groupName).toBe("Me, Ada");
  });

  it("keeps person isolation: never a room of theirs the viewer is not in, a hidden or archived room", async () => {
    const base = await serve(member("pr_me"));
    const body = await (await fetch(`${base}/api/people/pr_ada/library`)).json() as { files: Array<{ name: string }> };
    const names = body.files.map((entry) => entry.name);
    for (const name of ["secret.pdf", "mine.pdf", "hidden.pdf", "old.pdf"]) expect(names).not.toContain(name);
    const bob = await (await fetch(`${base}/api/people/pr_bob/library`)).json() as { files: unknown[] };
    expect(bob.files).toEqual([]);
  });

  it("answers an empty list to a caller without a person, and for yourself", async () => {
    const anonymous = await serve({ kind: "loopback", trust: "service" } as never);
    expect((await (await fetch(`${anonymous}/api/people/pr_ada/library`)).json() as { files: unknown[] }).files).toEqual([]);
    expect(roomsInCommon(ROOMS, "pr_me", "PR_ME", () => true)).toEqual([]);
  });
});
