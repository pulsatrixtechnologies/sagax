// Local VM hygiene: tests never make a container under the real name, a
// Local VM is never created in a temporary folder, every container names
// the folder it was made for, and the desktop app gets the same hardened
// recipe this server uses (server/computer/container-computer.ts).
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONTAINER, DESKTOP_PASSWORD_PLACEHOLDER, DESKTOP_WORKSPACE_PLACEHOLDER, IMAGE, LOCAL_VM_TEST_NAMESPACE, REAL_CONTAINER,
  SHARED_LOCAL_VM_TARGET, TEST_RUN_LABEL, WORKSPACE_PATH_LABEL, containerRunArgs, localVmFolderRefusal, localVmDesktopSpec,
  localVmTestNamespace, workspaceIsTemporary,
} from "./container-computer.ts";
import { removeTestLocalVms } from "../testing/local-vm-namespace.ts";

describe("Local VM names in tests", () => {
  it("gives this test run its own labeled container name, never openmausbot-computer", () => {
    expect(LOCAL_VM_TEST_NAMESPACE).not.toBe("");
    expect(CONTAINER).not.toBe(REAL_CONTAINER);
    expect(CONTAINER).toBe(`openmausbot-test-${LOCAL_VM_TEST_NAMESPACE}-computer`);
    const args = containerRunArgs("docker", "pw");
    expect(args.join(" ")).toContain(`--name ${CONTAINER}`);
    expect(args.join(" ")).toContain(`--label ${TEST_RUN_LABEL}=${LOCAL_VM_TEST_NAMESPACE}`);
  });

  it("accepts only a short, plain namespace", () => {
    expect(localVmTestNamespace(" T1-abc ")).toBe("t1-abc");
    expect(localVmTestNamespace("../x")).toBe("");
    expect(localVmTestNamespace("")).toBe("");
    expect(localVmTestNamespace(undefined)).toBe("");
  });

  it("cleans up only the containers labeled with the run's namespace", async () => {
    const calls: string[][] = [];
    const removed = await removeTestLocalVms("t1-abc", async (command, args) => {
      calls.push([command, ...args]);
      if (command === "podman") throw new Error("not installed");
      return { stdout: args[0] === "ps" ? "0123abcd\nfeedbeef\n" : "" };
    });
    expect(removed).toEqual(["0123abcd", "feedbeef"]);
    expect(calls[0]).toEqual(["docker", "ps", "-aq", "--filter", "label=com.openmausbot.test-run=t1-abc"]);
    expect(calls[1]).toEqual(["docker", "rm", "-f", "0123abcd", "feedbeef"]);
    expect(calls.flat()).not.toContain(REAL_CONTAINER);
    await expect(removeTestLocalVms("bad name", async () => ({ stdout: "" }))).rejects.toThrow(/invalid/);
  });
});

describe("Local VM folders", () => {
  it("labels each container with the folder it was created for", () => {
    const args = containerRunArgs("docker", "pw", { ...SHARED_LOCAL_VM_TARGET, workspaceDir: "/Users/ada/.openmausbot/vm-home" });
    expect(args.join(" ")).toContain(`--label ${WORKSPACE_PATH_LABEL}=/Users/ada/.openmausbot/vm-home`);
  });

  it("knows a temporary folder, with or without macOS's /private prefix", () => {
    expect(workspaceIsTemporary("/var/folders/5f/x/T/omb-org-mcp-1/.openmausbot/vm-home", "/var/folders/5f/x/T")).toBe(true);
    expect(workspaceIsTemporary("/private/var/folders/5f/x/T/omb-1/vm-home", "/var/folders/5f/x/T")).toBe(true);
    expect(workspaceIsTemporary("/Users/ada/.openmausbot/vm-home", "/var/folders/5f/x/T")).toBe(false);
    expect(workspaceIsTemporary("/tmpfoo/vm-home", "/tmp")).toBe(false);
    const root = tmpdir();
    expect(workspaceIsTemporary(join(root, "omb-1", "vm-home"), root)).toBe(true);
  });

  it("refuses to create a real-named Local VM in a temporary folder, never a test's namespaced one", () => {
    const tmp = { workspaceDir: "/var/folders/5f/x/T/omb-org-mcp-Em133z/.openmausbot/vm-home" };
    expect(localVmFolderRefusal(tmp, "", "/var/folders/5f/x/T")).toMatch(/temporary folder/);
    expect(localVmFolderRefusal(tmp, "t1-abc", "/var/folders/5f/x/T")).toBeNull();
    expect(localVmFolderRefusal({ workspaceDir: "/Users/ada/.openmausbot/vm-home" }, "", "/var/folders/5f/x/T")).toBeNull();
  });
});

describe("the desktop's Local VM recipe", () => {
  it("is this server's hardened run with the desktop's folder and password as placeholders", () => {
    const spec = localVmDesktopSpec();
    expect(spec.container).toBe(REAL_CONTAINER);
    expect(spec.image).toBe(IMAGE);
    expect(spec.dockerfile.startsWith(`FROM ${spec.baseImage}`)).toBe(true);
    for (const args of [spec.run.docker, spec.run.podman]) {
      const line = args.join(" ");
      expect(args[0]).toBe("run");
      expect(line).toContain(`--name ${REAL_CONTAINER}`);
      expect(line).toContain(`source=${DESKTOP_WORKSPACE_PLACEHOLDER},`);
      expect(line).toContain(`VNC_PW=${DESKTOP_PASSWORD_PLACEHOLDER}`);
      expect(line).toContain(`${WORKSPACE_PATH_LABEL}=${DESKTOP_WORKSPACE_PLACEHOLDER}`);
      expect(line).toContain("--cap-drop ALL");
      expect(line).not.toContain(TEST_RUN_LABEL);
      expect(args.at(-1)).toBe(IMAGE);
    }
  });
});
