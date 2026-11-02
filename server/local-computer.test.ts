import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DRIVER_FILE_IDENTITY_KEYS,
  REQUIRED_LINUX_TOOLS,
  decodeLinuxDescriptor,
  gatedLocalComputer,
  readCuaConnection,
  readCuaUnavailableReason,
  validateLinuxDescriptorRuntime,
} from "./local-computer.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

const require = createRequire(import.meta.url);
const { DRIVER_FILE_IDENTITY_KEYS: ELECTRON_DRIVER_FILE_IDENTITY_KEYS } = require(
  "../electron/cua-linux.cjs",
);
const { REQUIRED_TOOLS: ELECTRON_REQUIRED_TOOLS } = require("../electron/cua-linux-runtime.cjs");

function linuxDescriptor(userData: string, { session = "x11" }: { session?: "x11" | "wayland" } = {}) {
  const binary = join(userData, "cua-driver");
  const socket = join(userData, "runtime", "driver.sock");
  writeFileSync(binary, "fake", { mode: 0o700 });
  const stat = statSync(binary, { bigint: true });
  const fileIdentity = {
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: String(stat.uid),
    gid: String(stat.gid),
    mode: String(stat.mode),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
  return {
    schemaVersion: 1,
    mode: session === "wayland" ? "linux-wayland-gnome-supervised" : "linux-x11-supervised",
    platform: "linux",
    session,
    ...(session === "wayland" ? { compositor: "gnome-mutter" } : {}),
    enabled: true,
    status: "ready",
    ownerPid: process.pid,
    generation: "01234567-89ab-cdef-0123-456789abcdef",
    driver: {
      path: binary,
      version: "0.33.0",
      source: "environment",
      manifestSchema: "1",
      fileIdentity,
    },
    daemon: {
      socketPath: socket,
      pid: process.pid,
      contractVersion: "0.8.0",
      toolsListSchemaVersion: "1",
      capabilityVersion: "1",
      mcpProtocolVersion: "2025-06-18",
    },
    mcp: {
      command: binary,
      args: ["mcp", "--embedded", "--socket", socket],
      env: {
        CUA_DRIVER_EMBEDDED: "1",
        CUA_DRIVER_HOST_BUNDLE_ID: "com.openmausbot.app",
        CUA_DRIVER_RS_UPDATE_CHECK: "false",
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
        ...(session === "wayland" ? { CUA_DRIVER_RS_ENABLE_WAYLAND: "1" } : {}),
      },
    },
    toolNames: ["click", "get_window_state", "list_apps", "type_text"],
    doctorWarnings: [],
  };
}

describe("local computer descriptor contract", () => {
  it("wraps only the transport while preserving descriptor identity and original driver environment", () => {
    const connection = {
      command: "/trusted/cua-driver", args: ["mcp", "--socket", "/trusted/driver.sock"],
      env: { CUA_DRIVER_EMBEDDED: "1", DISPLAY: ":4" },
      platform: "linux" as const, scope: "local-computer" as const, generation: "fixture-generation",
    };
    const gated = gatedLocalComputer(connection, { url: "http://127.0.0.1:1234/control", token: "fixture-token" });
    expect(gated).toMatchObject({ command: process.execPath, args: ["--experimental-strip-types", SPAWNED_PROXIES.localComputer], platform: "linux", scope: "local-computer", generation: connection.generation });
    expect(gated.env).toEqual({ ...connection.env, ELECTRON_RUN_AS_NODE: "1", SAGAX_CUA_COMMAND: connection.command, SAGAX_CUA_ARGS: JSON.stringify(connection.args), SAGAX_CONTROL_URL: "http://127.0.0.1:1234/control", SAGAX_CONTROL_TOKEN: "fixture-token", SAGAX_COMPUTER_JOURNAL: "0" });
    // the saved-steps journal tap is asked for explicitly, never inherited
    expect(gatedLocalComputer(connection, { url: "http://127.0.0.1:1234/control", token: "fixture-token" }, true).env.SAGAX_COMPUTER_JOURNAL).toBe("1");
    expect(gated.args.join(" ")).not.toContain("fixture-token");
    expect(connection.env).not.toHaveProperty("SAGAX_CONTROL_TOKEN");
  });
  it("owns the helper's Node mode even when the daemon environment disagrees", () => {
    const gated = gatedLocalComputer({ command: "/trusted/cua-driver", args: ["mcp"], env: { ELECTRON_RUN_AS_NODE: "0" }, platform: "darwin", scope: "local-computer" }, { url: "http://127.0.0.1:1234/control", token: "fixture-token" });
    expect(gated.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });
  it("stays synchronized with the Electron producer", () => {
    expect(DRIVER_FILE_IDENTITY_KEYS).toEqual([...ELECTRON_DRIVER_FILE_IDENTITY_KEYS]);
    expect(REQUIRED_LINUX_TOOLS).toEqual([...ELECTRON_REQUIRED_TOOLS]);
  });
});

const temporaryDirectories: string[] = [];

function privateUserData(name: string) {
  const base = process.platform === "win32" ? tmpdir() : realpathSync("/tmp");
  const root = mkdtempSync(join(base, "omb-local-computer-"));
  temporaryDirectories.push(root);
  const userData = join(root, name);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  chmodSync(userData, 0o700);
  return userData;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local computer descriptor", () => {
  it("reports the app's unavailable reason without making that record mountable", () => {
    const reason = "embedded host failed: Screen Recording required; grant access in System Settings and restart Sagax";
    const record = { mode: "unavailable", reason };
    expect(readCuaConnection({ platform: "darwin", record })).toBeNull();
    expect(readCuaUnavailableReason({ platform: "darwin", record })).toBe(reason);
    expect(readCuaUnavailableReason({ platform: "darwin", record: { mode: "unavailable", reason: { message: reason } } })).toBeNull();
    expect(readCuaUnavailableReason({ platform: "darwin", record: { mode: "unavailable", reason, mcpCommand: "/fixture/driver" } })).toBeNull();
    expect(readCuaUnavailableReason({ platform: "linux", record })).toBeNull();
  });

  it("rejects an explicitly unavailable or malformed status on an otherwise complete connection", () => {
    const connection = {
      mode: "embedded", socketPath: "/fixture/cua.sock", mcpCommand: "/fixture/cua-driver",
      mcpArgs: ["mcp"], mcpEnv: {},
    };
    for (const status of ["unavailable", null, {}]) {
      expect(readCuaConnection({ platform: "darwin", record: { ...connection, status } })).toBeNull();
      expect(readCuaConnection({ platform: "win32", record: { ...connection, status } })).toBeNull();
    }
  });

  it("uses nothing but the record the desktop app handed over: no file, folder or environment", () => {
    const userData = privateUserData("app-user-data");
    const home = join(userData, "fixture-home");
    const ready = {
      mode: "embedded", socketPath: "/fixture/cua.sock", mcpCommand: "/fixture/cua-driver",
      mcpArgs: ["mcp"], mcpEnv: {},
    };
    // The app's own state file and every old Application Support location.
    writeFileSync(join(userData, "cua-connection.json"), JSON.stringify(ready), { mode: 0o600 });
    for (const directory of ["Pulsa Bot", "openmausbot", "OpenGrokBot", "opengrokbot", "Sagax"]) {
      mkdirSync(join(home, "Library", "Application Support", directory), { recursive: true, mode: 0o700 });
      writeFileSync(join(home, "Library", "Application Support", directory, "cua-connection.json"), JSON.stringify(ready), { mode: 0o600 });
    }
    const saved = { userData: process.env.SAGAX_USER_DATA, home: process.env.HOME };
    process.env.SAGAX_USER_DATA = userData;
    process.env.HOME = home;
    try {
      for (const platform of ["darwin", "win32", "linux"] as const) {
        expect(readCuaConnection({ platform })).toBeNull();
        expect(readCuaUnavailableReason({ platform })).toBeNull();
      }
    } finally {
      if (saved.userData === undefined) delete process.env.SAGAX_USER_DATA;
      else process.env.SAGAX_USER_DATA = saved.userData;
      if (saved.home === undefined) delete process.env.HOME;
      else process.env.HOME = saved.home;
    }
    expect(readCuaConnection({ platform: "darwin", record: ready })).toMatchObject({ command: "/fixture/cua-driver", platform: "darwin" });
  });

  it("does not let a caller change the connection it was handed", () => {
    const record = { mode: "embedded", socketPath: "/fixture/cua.sock", mcpCommand: "/fixture/cua-driver", mcpArgs: ["mcp"], mcpEnv: { A: "1" } };
    const connection = readCuaConnection({ platform: "darwin", record })!;
    connection.args.push("--evil");
    connection.env.B = "2";
    expect(record.mcpArgs).toEqual(["mcp"]);
    expect(record.mcpEnv).toEqual({ A: "1" });
  });

  it("accepts only the exact certified Linux X11 descriptor", () => {
    const userData = privateUserData("linux-user-data");
    const descriptor = linuxDescriptor(userData);

    expect(
      readCuaConnection({
        platform: "linux",
        record: descriptor,
        validateLinuxRuntime: () => true,
      }),
    ).toEqual({
      command: descriptor.driver.path,
      args: descriptor.mcp.args,
      env: descriptor.mcp.env,
      platform: "linux",
      generation: descriptor.generation,
      scope: "local-computer",
    });
  });

  it("accepts the exact GNOME Wayland descriptor without weakening the X11 contract", () => {
    const userData = privateUserData("linux-wayland-user-data");
    const descriptor = linuxDescriptor(userData, { session: "wayland" });
    expect(decodeLinuxDescriptor(descriptor)).toEqual({
      command: descriptor.driver.path,
      args: descriptor.mcp.args,
      env: descriptor.mcp.env,
      platform: "linux",
      generation: descriptor.generation,
      scope: "local-computer",
    });
    expect(decodeLinuxDescriptor({ ...descriptor, compositor: "kde-kwin" })).toBeNull();
    const { CUA_DRIVER_RS_ENABLE_WAYLAND: _missing, ...x11OnlyEnv } = descriptor.mcp.env;
    expect(
      decodeLinuxDescriptor({ ...descriptor, mcp: { ...descriptor.mcp, env: x11OnlyEnv } }),
    ).toBeNull();
    const x11Descriptor = linuxDescriptor(userData);
    expect(
      decodeLinuxDescriptor({
        ...x11Descriptor,
        mcp: {
          ...x11Descriptor.mcp,
          env: { ...x11Descriptor.mcp.env, CUA_DRIVER_RS_ENABLE_WAYLAND: "1" },
        },
      }),
    ).toBeNull();
  });

  it("rejects unknown fields, stale modes, arbitrary argv, and incomplete tool surfaces", () => {
    const userData = privateUserData("linux-invalid-user-data");
    const descriptor = linuxDescriptor(userData);
    expect(decodeLinuxDescriptor({ ...descriptor, unexpected: true })).toBeNull();
    expect(decodeLinuxDescriptor({ ...descriptor, status: "starting" })).toBeNull();
    const { CUA_DRIVER_RS_TELEMETRY_ENABLED: _telemetry, ...telemetryMissing } =
      descriptor.mcp.env;
    expect(
      decodeLinuxDescriptor({
        ...descriptor,
        mcp: { ...descriptor.mcp, env: telemetryMissing },
      }),
    ).toBeNull();
    expect(
      decodeLinuxDescriptor({
        ...descriptor,
        mcp: { ...descriptor.mcp, args: ["mcp", "--socket", descriptor.daemon.socketPath, "--evil"] },
      }),
    ).toBeNull();
    expect(decodeLinuxDescriptor({ ...descriptor, toolNames: ["list_apps"] })).toBeNull();
    expect(
      decodeLinuxDescriptor({
        ...descriptor,
        mcp: {
          ...descriptor.mcp,
          env: { ...descriptor.mcp.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: "true" },
        },
      }),
    ).toBeNull();
    expect(
      decodeLinuxDescriptor({
        ...descriptor,
        driver: { ...descriptor.driver, fileIdentity: { ...descriptor.driver.fileIdentity, extra: "1" } },
      }),
    ).toBeNull();
    const { fileIdentity: _missingIdentity, ...driverWithoutIdentity } = descriptor.driver;
    expect(decodeLinuxDescriptor({ ...descriptor, driver: driverWithoutIdentity })).toBeNull();
  });

  it("fails closed when runtime ownership or liveness validation fails", () => {
    const userData = privateUserData("linux-stale-user-data");
    const descriptor = linuxDescriptor(userData);
    expect(
      readCuaConnection({ platform: "linux", record: descriptor, validateLinuxRuntime: () => false }),
    ).toBeNull();
  });

  // Runtime ownership includes a real Linux Unix-domain socket and POSIX
  // permission checks. Keep the schema/decoder cases above cross-platform,
  // but run this host-filesystem proof only on the authoritative Linux lane.
  it.skipIf(process.platform !== "linux")(
    "validates the executable, socket, and live owned processes the record names",
    async () => {
      const userData = privateUserData("linux-runtime-security");
      const runtimeDirectory = join(userData, "runtime");
      mkdirSync(runtimeDirectory, { mode: 0o700 });
      const descriptor = linuxDescriptor(userData);
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(descriptor.daemon.socketPath, resolve);
      });
      try {
        chmodSync(descriptor.daemon.socketPath, 0o600);
        expect(validateLinuxDescriptorRuntime(descriptor)).toBe(true);
        expect(readCuaConnection({ platform: "linux", record: descriptor })).not.toBeNull();
        chmodSync(runtimeDirectory, 0o755);
        expect(validateLinuxDescriptorRuntime(descriptor)).toBe(false);
        chmodSync(runtimeDirectory, 0o700);
        expect(validateLinuxDescriptorRuntime(descriptor)).toBe(true);
        appendFileSync(descriptor.driver.path, "changed after descriptor publication");
        expect(validateLinuxDescriptorRuntime(descriptor)).toBe(false);
        expect(readCuaConnection({ platform: "linux", record: descriptor })).toBeNull();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it("still rejects an old embedded-looking Linux descriptor", () => {
    expect(readCuaConnection({ platform: "linux", record: {
      mode: "embedded",
      mcpCommand: "/tmp/cua-driver",
      mcpArgs: ["mcp", "--embedded"],
      mcpEnv: { CUA_DRIVER_EMBEDDED: "1" },
    } })).toBeNull();
  });

  it("preserves the selected Windows descriptor contract", () => {
    expect(readCuaConnection({ platform: "win32", record: {
      mode: "embedded",
      socketPath: "\\\\.\\pipe\\cua-driver",
      mcpCommand: "C:\\cua-driver.exe",
      mcpArgs: ["mcp"],
      mcpEnv: { CUA_DRIVER_EMBEDDED: "1" },
    } })).toEqual({
      command: "C:\\cua-driver.exe",
      args: ["mcp"],
      env: { CUA_DRIVER_EMBEDDED: "1" },
      platform: "win32",
      scope: "local-computer",
    });
  });

  it("rejects malformed legacy argv and environment values", () => {
    expect(readCuaConnection({ platform: "win32", record: { mode: "embedded", mcpCommand: "cua-driver", mcpArgs: "mcp" } })).toBeNull();
    expect(readCuaConnection({ platform: "win32", record: { mode: "unknown", mcpCommand: "cua-driver", mcpArgs: ["mcp"] } })).toBeNull();
  });
});
