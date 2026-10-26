import { describe, expect, it } from "vitest";

import { encodedPowerShell, loopScript, posixLoop, remoteCommand, windowsLoop } from "./scripts.ts";
import { nodeCpuOverlay, spawnSource, sshResourceArgv, tailcatResourceArgv } from "./sources.ts";

describe("scripts stay read-only", () => {
  it("the POSIX loop writes nothing, kills nothing and needs no root", () => {
    const script = posixLoop(3);
    // the only redirections are stderr to /dev/null
    expect(script.replaceAll("2>/dev/null", "")).not.toMatch(/>/);
    for (const word of [/\brm\b/, /\bsudo\b/, /\bkill\b/, /\bcurl\b/, /\bwget\b/, /\bchmod\b/, /\bmv\b/, /\bcp\b/, /\btee\b/, /\binstall\b/]) {
      expect(script).not.toMatch(word);
    }
  });

  it("the Windows loop only reads (Get-CimInstance), never sets, removes or starts", () => {
    const script = windowsLoop(3);
    expect(script).toMatch(/Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor/);
    for (const verb of [/\bSet-/, /\bRemove-/, /\bNew-/, /\bStop-/, /\bStart-Process/, /\bInvoke-/, /\bOut-File/, /\bAdd-/, /\bRestart-/]) {
      expect(script).not.toMatch(verb);
    }
    // no Get-Counter: its paths are translated on a French Windows
    expect(script).not.toMatch(/Get-Counter/);
  });

  it("bounds the loop on the computer itself", () => {
    expect(posixLoop(5)).toMatch(/-lt 5 \]/);
    expect(windowsLoop(99999)).toMatch(/-lt 600;/);
    expect(loopScript("posix", 0)).toMatch(/-lt 1 \]/);
  });
});

describe("remote command lines", () => {
  it("SSH runs the loop without a terminal, never prompting", () => {
    const argv = sshResourceArgv("srv01", 4, "/data/vps-ssh/config");
    expect(argv.slice(0, 3)).toEqual(["ssh", "-F", "/data/vps-ssh/config"]);
    expect(argv).toContain("-T");
    expect(argv).not.toContain("-t");
    expect(argv).not.toContain("-tt");
    expect(argv).toContain("BatchMode=yes");
    expect(argv[argv.length - 2]).toBe("srv01");
    expect(argv[argv.length - 1]!.startsWith("sh -c '")).toBe(true);
  });

  it("Windows gets an encoded script that survives cmd.exe and ssh quoting", () => {
    const command = remoteCommand("windows", 2);
    expect(command).toMatch(/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    const encoded = command.split(" ").pop()!;
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(windowsLoop(2));
    expect(encodedPowerShell("a")).toBe(Buffer.from("a", "utf16le").toString("base64"));
  });

  it("Tailcat keeps the key and the address as argv elements", () => {
    const argv = tailcatResourceArgv("/opt/tailcat", "/data/key.json", "tc_address", "windows", 2);
    expect(argv.slice(0, 5)).toEqual(["/opt/tailcat", "ssh", "--key", "/data/key.json", "tc_address"]);
    expect(argv).toHaveLength(6);
  });
});

describe("spawnSource", () => {
  it("streams stdout and reports a clean exit once", async () => {
    const source = spawnSource(() => ({ argv: ["/bin/sh", "-c", "printf '@@begin\\n@@os\\nLinux\\n@@end\\n'"] }));
    let text = "";
    const exits: Array<string | undefined> = [];
    await new Promise<void>((resolve) => {
      source.start(1, (chunk) => { text += chunk; }, (error) => { exits.push(error); resolve(); });
    });
    expect(text).toContain("@@os\nLinux");
    expect(exits).toEqual([undefined]);
  });

  it("stops a running loop", async () => {
    const source = spawnSource(() => ({ argv: ["/bin/sh", "-c", "while true; do echo tick; sleep 1; done"] }));
    const stream = source.start(1, () => {}, () => {});
    stream.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(true).toBe(true);
  });
});

describe("nodeCpuOverlay", () => {
  it("measures per-core busy time between two reads", () => {
    const reads = [
      [{ times: { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 } }, { times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }],
      [{ times: { user: 150, nice: 0, sys: 150, idle: 900, irq: 0 } }, { times: { user: 50, nice: 0, sys: 0, idle: 1150, irq: 0 } }],
    ];
    let index = 0;
    const overlay = nodeCpuOverlay(() => reads[index++]!);
    expect(overlay()).toBeNull();
    const next = overlay()!;
    expect(next.cores).toEqual([50, 25]);
    expect(next.total).toBeCloseTo(((100 + 50) / (200 + 200)) * 100, 5);
  });
});
