import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { desktopComputerRecord, launchedByDesktopApp, listenForDesktopComputer, LOCAL_COMPUTER_MESSAGE } from "./desktop-computer.ts";
import { readCuaConnection } from "../local-computer.ts";

function fakeParentPort() {
  const listeners: Array<(event: { data?: unknown }) => void> = [];
  return {
    on(_event: "message", listener: (event: { data?: unknown }) => void) { listeners.push(listener); },
    deliver(data: unknown) { for (const listener of listeners) listener({ data }); },
  };
}

const ready = {
  mode: "embedded", socketPath: "/fixture/cua.sock", mcpCommand: "/fixture/cua-driver",
  mcpArgs: ["mcp"], mcpEnv: {},
};

describe("this computer, handed over by the desktop app", () => {
  it("a server started without the app's parent port has no connection and says so", () => {
    expect(listenForDesktopComputer(undefined)).toBe(false);
    expect(launchedByDesktopApp()).toBe(false);
    expect(desktopComputerRecord()).toBeNull();
    expect(readCuaConnection({ platform: "darwin" })).toBeNull();
  });

  it("takes the connection only from the parent port, and follows every change", () => {
    const port = fakeParentPort();
    expect(listenForDesktopComputer(port)).toBe(true);
    expect(launchedByDesktopApp()).toBe(true);

    port.deliver({ type: LOCAL_COMPUTER_MESSAGE, connection: ready });
    expect(readCuaConnection({ platform: "darwin" })).toMatchObject({ command: "/fixture/cua-driver" });

    // Other private messages leave it alone.
    port.deliver({ type: "openmausbot:desktop-mutation-token", token: "x" });
    port.deliver("not an object");
    expect(readCuaConnection({ platform: "darwin" })).not.toBeNull();

    // The driver stopped or became unavailable.
    port.deliver({ type: LOCAL_COMPUTER_MESSAGE, connection: { mode: "unavailable", reason: "stopped" } });
    expect(readCuaConnection({ platform: "darwin" })).toBeNull();
    port.deliver({ type: LOCAL_COMPUTER_MESSAGE, connection: ready });
    port.deliver({ type: LOCAL_COMPUTER_MESSAGE, connection: null });
    expect(desktopComputerRecord()).toBeNull();
  });

  it("keeps its own frozen copy of what the app sent", () => {
    const port = fakeParentPort();
    listenForDesktopComputer(port);
    const sent = structuredClone(ready);
    port.deliver({ type: LOCAL_COMPUTER_MESSAGE, connection: sent });
    sent.mcpCommand = "/elsewhere";
    expect(desktopComputerRecord()?.mcpCommand).toBe("/fixture/cua-driver");
    expect(Object.isFrozen(desktopComputerRecord())).toBe(true);
    port.deliver({ type: LOCAL_COMPUTER_MESSAGE, connection: null });
  });

  it("no server code reads this computer's connection from a file or the environment", () => {
    for (const file of ["../local-computer.ts", "./desktop-computer.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/readFileSync|cua-connection\.json|Application Support|process\.env/);
    }
  });
});
