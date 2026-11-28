import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  linkedFoldersOf,
  migrateFolderGrantToExecutionAccess,
  pathInLinkedFolders,
  type FolderSharingGrant,
} from "./paired-workspace-access.ts";

const folder = (path: string, write = false) => ({
  id: randomUUID(),
  path,
  name: path.replace(/^.*\//, "") || "Folder",
  write,
});

describe("paired workspace access migration (#4856)", () => {
  it("keeps already-linked folders and never turns a read-only grant into Always allow", () => {
    const invoices = folder("/fixture/Invoices");
    const migrated = migrateFolderGrantToExecutionAccess({
      enabled: true,
      folders: [invoices],
      terminal: false,
      computer: false,
      sessionId: randomUUID(),
      environmentId: randomUUID(),
    });
    expect(migrated.access).toBe("ask");
    expect(migrated.folders).toEqual([invoices]);
    expect(migrated.sessionId).toMatch(/^[a-f0-9-]{36}$/i);
    expect(migrated.environmentId).toMatch(/^[a-f0-9-]{36}$/i);
  });

  it("maps a previous execute grant (terminal or screen) to Always allow without dropping folders", () => {
    const docs = folder("/fixture/Docs", true);
    expect(migrateFolderGrantToExecutionAccess({
      enabled: true, folders: [docs], terminal: true, computer: false,
    }).access).toBe("always");
    expect(migrateFolderGrantToExecutionAccess({
      enabled: true, folders: [docs], terminal: false, computer: true,
    })).toMatchObject({ access: "always", folders: [docs] });
  });

  it("revoked and empty grants become Never; Cloud grants are left off this path", () => {
    expect(migrateFolderGrantToExecutionAccess({ enabled: false, folders: [folder("/a")], terminal: true }).access).toBe("never");
    expect(migrateFolderGrantToExecutionAccess(null).access).toBe("never");
    expect(migrateFolderGrantToExecutionAccess({
      enabled: true, folders: [folder("/a")], computer: true, cloud: { accountId: "x", origin: "https://cloud.example" },
    }).access).toBe("never");
  });

  it("linkedFoldersOf keeps valid rows only", () => {
    const ok = folder("/fixture/Ok");
    expect(linkedFoldersOf([ok, { id: "bad", path: "relative", write: false }, null])).toEqual([ok]);
  });

  it("pathInLinkedFolders scopes reads to linked folders", () => {
    const root = folder("/fixture/Invoices");
    expect(pathInLinkedFolders("/fixture/Invoices/a.txt", [root])).toBe(true);
    expect(pathInLinkedFolders("/fixture/Other/a.txt", [root])).toBe(false);
  });
});

describe("paired workspace fixture cases (#4856)", () => {
  const sessionId = randomUUID();
  const environmentId = randomUUID();
  const invoices = folder("/fixture/Invoices");

  function grant(patch: Partial<FolderSharingGrant> = {}): FolderSharingGrant {
    return {
      enabled: true,
      folders: [invoices],
      terminal: true,
      computer: false,
      sessionId,
      environmentId,
      ...patch,
    };
  }

  it("active: enabled execute grant keeps the folder binding and Always allow", () => {
    const access = migrateFolderGrantToExecutionAccess(grant());
    expect(access).toMatchObject({ access: "always", folders: [invoices], sessionId, environmentId });
  });

  it("revoked: disabled grant is Never and still keeps the linked folder", () => {
    expect(migrateFolderGrantToExecutionAccess(grant({ enabled: false }))).toMatchObject({
      access: "never", folders: [invoices], sessionId, environmentId,
    });
  });

  it("re-paired: a new session id on the same workspace keeps folders; execute stays distinct from read", () => {
    const nextSession = randomUUID();
    const before = migrateFolderGrantToExecutionAccess(grant({ terminal: false, computer: false }));
    expect(before.access).toBe("ask");
    const after = migrateFolderGrantToExecutionAccess(grant({
      sessionId: nextSession, terminal: false, computer: false,
    }));
    expect(after.folders).toEqual(before.folders);
    expect(after.environmentId).toBe(environmentId);
    expect(after.sessionId).toBe(nextSession);
    expect(after.access).toBe("ask");
  });

  it("different person: migration never invents another workspace binding", () => {
    const access = migrateFolderGrantToExecutionAccess(grant());
    expect(access.sessionId).toBe(sessionId);
    expect(access.environmentId).toBe(environmentId);
    expect(migrateFolderGrantToExecutionAccess(grant({ sessionId: undefined, environmentId: undefined }))).toMatchObject({
      sessionId: null, environmentId: null,
    });
  });
});
