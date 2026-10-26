// Fixed read-only probes for a Tailcat session. The command text is ours:
// nothing the person or the model typed is interpolated into it.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { isTailcatAddress, parseRemoteSessionCode, REMOTE_SESSION_ID, type RemoteSessionOs } from "../shared/remote-session.ts";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Stopped at its time limit. */
  timedOut?: boolean;
}

export type RunCommand = (argv: string[], timeoutMs: number) => Promise<CommandResult>;

const SHOT_NAME = "px-sagax-shot.png";

export function flowHome(): string {
  const fromEnv = process.env.PX_FLOW_HOME?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(homedir(), ".pulsatrix-flow");
}

export function sessionDir(home: string, id: string): string {
  return path.join(home, "tailcat", id);
}

function validAddress(address: string): boolean {
  return isTailcatAddress(address);
}

/** The row a tunnel is resolved for: its id, its support code and who owns it. */
export interface TunnelOwner {
  id: string;
  code?: string;
  principalId?: string;
  botId?: string;
}

/** Who remote_support_open recorded as the opener of `sessions/<CODE>/`, or null. */
export function supportFolderOwner(dir: string, code: string): { id: string; principalId?: string; botId?: string } | null {
  const compact = parseRemoteSessionCode(code);
  if (!compact) return null;
  const folder = path.join(path.resolve(dir), "sessions", compact);
  let id = "";
  try {
    id = readFileSync(path.join(folder, "session"), "utf8").trim();
  } catch {
    return null;
  }
  if (!REMOTE_SESSION_ID.test(id)) return null;
  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path.join(folder, "open.json"), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
  } catch {
    /* an owner-less folder */
  }
  const principalId = typeof meta.principalId === "string" && meta.principalId.trim() ? normPrincipal(meta.principalId) : undefined;
  const botId = typeof meta.botId === "string" && meta.botId.trim() ? meta.botId.trim() : undefined;
  return { id, ...(principalId ? { principalId } : {}), ...(botId ? { botId } : {}) };
}

interface ScannedOwner { code: string; id: string; principalId?: string; botId?: string }
// The sessions directory is scanned once per change, not once per publish or
// close: the scan is cached and reused while the directory's mtime is
// unchanged (a new session folder bumps it, which re-scans).
const scanCache = new Map<string, { mtimeMs: number; owners: ScannedOwner[] }>();

function scanSupportOwners(dir: string): ScannedOwner[] {
  const sessions = path.join(path.resolve(dir), "sessions");
  let mtimeMs: number;
  try {
    mtimeMs = statSync(sessions).mtimeMs;
  } catch {
    scanCache.delete(path.resolve(dir));
    return [];
  }
  const cached = scanCache.get(path.resolve(dir));
  if (cached && cached.mtimeMs === mtimeMs) return cached.owners;
  const owners: ScannedOwner[] = [];
  let codes: string[] = [];
  try {
    codes = readdirSync(sessions);
  } catch {
    codes = [];
  }
  for (const code of codes) {
    const owner = supportFolderOwner(dir, code);
    if (!owner) continue;
    owners.push({ code, id: owner.id, ...(owner.principalId ? { principalId: owner.principalId } : {}), ...(owner.botId ? { botId: owner.botId } : {}) });
  }
  scanCache.set(path.resolve(dir), { mtimeMs, owners });
  return owners;
}

/** Every support folder that holds this session id, with its recorded owner. */
export function supportOwnersOfId(dir: string, id: string): Array<{ code: string; principalId?: string; botId?: string }> {
  if (!REMOTE_SESSION_ID.test(id)) return [];
  return scanSupportOwners(dir)
    .filter((owner) => owner.id === id)
    .map((owner) => ({ code: owner.code, ...(owner.principalId ? { principalId: owner.principalId } : {}), ...(owner.botId ? { botId: owner.botId } : {}) }));
}

export function normPrincipal(value: string): string {
  return value.trim().toLowerCase();
}

/** Remove session folders under `<dir>/sessions` not touched in `maxAgeMs`
 * (default 48 h). Best effort, synchronous, nothing thrown. Returns how many
 * folders were removed. */
export function pruneSupportSessions(dir: string, now: number, maxAgeMs = 48 * 60 * 60 * 1000): number {
  const sessions = path.join(path.resolve(dir), "sessions");
  let codes: string[] = [];
  try {
    codes = readdirSync(sessions);
  } catch {
    return 0;
  }
  const cutoff = now - maxAgeMs;
  let removed = 0;
  for (const code of codes) {
    const folder = path.join(sessions, code);
    try {
      if (statSync(folder).mtimeMs >= cutoff) continue;
      rmSync(folder, { recursive: true, force: true });
      removed++;
    } catch { /* leave it for the next sweep */ }
  }
  if (removed) scanCache.delete(path.resolve(dir));
  return removed;
}

/** A session Sagax opened itself (server/remote-support-local.ts): the
 * technician key is `<dir>/technician.private.json` and the address is in
 * `<dir>/sessions/<row.code>/address`. The folder must hold this very id and
 * name this row's person and bot as its opener: the id alone (it is on the
 * chat card) never resolves a tunnel, and a folder without an owner never does. */
export function readSupportTunnel(dir: string, row: TunnelOwner): { keyPath: string; address: string } | null {
  if (!REMOTE_SESSION_ID.test(row.id) || !row.code || !row.principalId || !row.botId) return null;
  const root = path.resolve(dir);
  const keyPath = path.join(root, "technician.private.json");
  try {
    readFileSync(keyPath);
  } catch {
    return null;
  }
  const owner = supportFolderOwner(root, row.code);
  if (!owner || owner.id !== row.id) return null;
  if (!owner.principalId || owner.principalId !== normPrincipal(row.principalId)) return null;
  if (!owner.botId || owner.botId !== row.botId) return null;
  let address = "";
  try {
    address = readFileSync(path.join(root, "sessions", parseRemoteSessionCode(row.code)!, "address"), "utf8").trim();
  } catch {
    return null;
  }
  return validAddress(address) ? { keyPath, address } : null;
}

/** The on-disk tunnel, or null when this host does not have it. The address
 * stays in the file; callers pass it only as an argv element and never log it.
 * The Flow session folder first, then the folder of a session Sagax opened. */
export function readTunnel(home: string, row: TunnelOwner, supportDir?: string): { keyPath: string; address: string } | null {
  if (!REMOTE_SESSION_ID.test(row.id)) return null;
  const flow = readFlowTunnel(home, row);
  if (flow) return flow;
  return supportDir ? readSupportTunnel(supportDir, row) : null;
}

/** A Flow session folder (`~/.pulsatrix-flow/tailcat/<id>`) carries no owner
 * when a Flow skill first drops it. The first person to publish it binds it
 * (bindFlowOwner); after that only that person and bot resolve its tunnel. */
export function flowOwner(home: string, id: string): { principalId: string; botId: string } | null {
  if (!REMOTE_SESSION_ID.test(id)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path.join(sessionDir(home, id), "owner.json"), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const principalId = typeof record.principalId === "string" ? normPrincipal(record.principalId) : "";
    const botId = typeof record.botId === "string" ? record.botId.trim() : "";
    return principalId && botId ? { principalId, botId } : null;
  } catch {
    return null;
  }
}

export type FlowBindResult = "no-folder" | "bound" | "match" | "other";

/** Bind a Flow folder to the first publisher. The folder must already exist
 * (a Flow skill created it); the binding goes in owner.json and never changes. */
export function bindFlowOwner(home: string, id: string, owner: { principalId: string; botId: string }): FlowBindResult {
  if (!REMOTE_SESSION_ID.test(id)) return "no-folder";
  const dir = sessionDir(home, id);
  try {
    statSync(dir);
  } catch {
    return "no-folder";
  }
  const existing = flowOwner(home, id);
  if (existing) {
    return existing.principalId === normPrincipal(owner.principalId) && existing.botId === owner.botId.trim() ? "match" : "other";
  }
  try {
    writeFileSync(path.join(dir, "owner.json"), `${JSON.stringify({ principalId: normPrincipal(owner.principalId), botId: owner.botId.trim() })}\n`, { mode: 0o600 });
    return "bound";
  } catch {
    return "no-folder";
  }
}

function readFlowTunnel(home: string, row: TunnelOwner): { keyPath: string; address: string } | null {
  const id = row.id;
  const dir = sessionDir(home, id);
  const keyPath = path.join(dir, "client.private.json");
  const addressPath = path.join(dir, "address");
  // A bound folder resolves only for the person and bot that first published it.
  const owner = flowOwner(home, id);
  if (owner && (!row.principalId || !row.botId || normPrincipal(row.principalId) !== owner.principalId || row.botId !== owner.botId)) {
    return null;
  }
  let address = "";
  try {
    address = readFileSync(addressPath, "utf8").trim();
  } catch {
    return null;
  }
  if (!validAddress(address)) return null;
  try {
    readFileSync(keyPath);
  } catch {
    return null;
  }
  const root = path.resolve(sessionDir(home, id));
  if (!path.resolve(keyPath).startsWith(root + path.sep)) return null;
  return { keyPath, address };
}

/** A PowerShell script for the Windows side of the tunnel. The Tailcat
 * session shell on Windows is PowerShell itself, so a script in a
 * double-quoted `-Command "..."` loses every `$variable` to the outer shell
 * before the inner one runs (the 8F2NZU n/a). -EncodedCommand carries the
 * script as base64 (UTF-16LE): no outer shell, PowerShell or cmd.exe, can
 * touch it. */
export function windowsScriptCommand(script: string): string {
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

/** The script inside a windowsScriptCommand line, for tests and logs. */
export function decodeWindowsScript(command: string): string | null {
  const match = /-EncodedCommand ([A-Za-z0-9+/=]+)/.exec(command);
  return match ? Buffer.from(match[1]!, "base64").toString("utf16le") : null;
}

/** First OS check through the tunnel: `uname -s` answers on macOS and
 * Linux; PowerShell on Windows does not know uname. */
export const OS_PROBE_UNIX = "uname -s";
/** Second check, only when uname failed: PowerShell prints Win32NT. A Unix
 * shell fails on it, so a Windows answer is never a guess. */
export const OS_PROBE_WINDOWS = "[Environment]::OSVersion.Platform";

/** What the two checks say. null: the computer did not answer clearly (ask
 * again later, never assume Windows). */
export function osFromProbe(unix: CommandResult | null, windows: CommandResult | null): RemoteSessionOs | null {
  const said = (unix?.stdout ?? "").toLowerCase();
  if (unix && unix.code === 0 && said.includes("darwin")) return "macos";
  if (unix && unix.code === 0 && said.includes("linux")) return "linux";
  if (windows && windows.code === 0 && /win32nt/i.test(windows.stdout)) return "windows";
  return null;
}

/** `ssh` exits 255 when the tunnel itself failed: the computer never answered. */
export const TRANSPORT_FAILED = 255;

export function inventoryCommand(os: RemoteSessionOs): string {
  if (os === "windows") {
    return windowsScriptCommand([
      "$cs=Get-CimInstance Win32_ComputerSystem",
      "$bios=Get-CimInstance Win32_BIOS",
      "$osInfo=Get-CimInstance Win32_OperatingSystem",
      "$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1",
      "$disk=Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq 'C:' } | Select-Object -First 1",
      "$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      // Server Core and Nano have no Explorer: no desktop to show
      "$gui=Test-Path (Join-Path $env:windir 'explorer.exe')",
      "Write-Output ('hostname=' + $cs.Name)",
      "Write-Output ('user=' + $cs.UserName)",
      "Write-Output ('model=' + $cs.Model)",
      "Write-Output ('serial=' + $bios.SerialNumber)",
      "Write-Output ('cpu=' + $cpu.Name)",
      "Write-Output ('os=' + $osInfo.Caption)",
      "Write-Output ('admin=' + $admin)",
      "Write-Output ('gui=' + $gui)",
      "Write-Output ('ramBytes=' + $cs.TotalPhysicalMemory)",
      "Write-Output ('diskFreeKb=' + [math]::Round($disk.FreeSpace/1KB))",
      "Write-Output ('diskTotalKb=' + [math]::Round($disk.Size/1KB))",
    ].join("\n"));
  }
  if (os === "macos") {
    // The Data volume holds the person's files on APFS; / is the sealed system.
    return [
      "hostname=$(scutil --get ComputerName 2>/dev/null || hostname)",
      "user=$(stat -f %Su /dev/console 2>/dev/null || id -un)",
      "model=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Model Name/{print $2; exit}')",
      "[ -n \"$model\" ] || model=$(sysctl -n hw.model)",
      "serial=$(ioreg -c IOPlatformExpertDevice -d 2 | awk -F'\"' '/IOPlatformSerialNumber/{print $4; exit}')",
      "cpu=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)",
      "os=\"$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)\"",
      "admin=$(id -Gn | grep -Eqw 'admin' && printf true || printf false)",
      "ramBytes=$(sysctl -n hw.memsize)",
      "printf 'hostname=%s\\nuser=%s\\nmodel=%s\\nserial=%s\\ncpu=%s\\nos=%s\\nadmin=%s\\ngui=true\\nramBytes=%s\\n' \"$hostname\" \"$user\" \"$model\" \"$serial\" \"$cpu\" \"$os\" \"$admin\" \"$ramBytes\"",
      "vol=/System/Volumes/Data; [ -d \"$vol\" ] || vol=/",
      "df -k \"$vol\" | awk 'NR==2{printf \"diskFreeKb=%s\\ndiskTotalKb=%s\\n\", $4, $2}'",
    ].join("; ");
  }
  return [
    "hostname=$(hostname)",
    "user=$(id -un)",
    "model=$(cat /sys/class/dmi/id/product_name 2>/dev/null)",
    "serial=$(cat /sys/class/dmi/id/product_serial 2>/dev/null)",
    "cpu=$(awk -F: '/model name/{gsub(/^[ \\t]+/, \"\", $2); print $2; exit}' /proc/cpuinfo)",
    "os=$( (. /etc/os-release 2>/dev/null && printf '%s' \"$PRETTY_NAME\") || uname -sr)",
    "admin=$(id -Gn | grep -Eqw 'sudo|wheel|admin' && printf true || printf false)",
    // a graphical session leaves an X11 or Wayland socket; a server has none
    "gui=$(ls /tmp/.X11-unix/X* /run/user/*/wayland-* >/dev/null 2>&1 && printf true || printf false)",
    "ramBytes=$(awk '/MemTotal/{print $2 * 1024; exit}' /proc/meminfo)",
    "printf 'hostname=%s\\nuser=%s\\nmodel=%s\\nserial=%s\\ncpu=%s\\nos=%s\\nadmin=%s\\ngui=%s\\nramBytes=%s\\n' \"$hostname\" \"$user\" \"$model\" \"$serial\" \"$cpu\" \"$os\" \"$admin\" \"$gui\" \"$ramBytes\"",
    "df -k / | awk 'NR==2{printf \"diskFreeKb=%s\\ndiskTotalKb=%s\\n\", $4, $2}'",
  ].join("; ");
}

/** The line a macOS screenshot prints when Screen Recording is not allowed
 * for the program that runs the session (the Terminal the person used). */
export const SCREEN_PERMISSION = "sagax-screen-permission";

export function screenshotPlan(os: RemoteSessionOs): { command: string; remotePathHint: string } {
  if (os === "windows") {
    return {
      remotePathHint: SHOT_NAME,
      command: windowsScriptCommand([
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
        "$bmp=New-Object System.Drawing.Bitmap([Math]::Max(1,$b.Width),[Math]::Max(1,$b.Height))",
        "$g=[System.Drawing.Graphics]::FromImage($bmp)",
        "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)",
        `$path=Join-Path $env:TEMP '${SHOT_NAME}'`,
        "$bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)",
        "$g.Dispose(); $bmp.Dispose(); Write-Output $path",
      ].join("\n")),
    };
  }
  const remote = `/tmp/${SHOT_NAME}`;
  if (os === "macos") {
    // screencapture fails ("could not create image from display") when the
    // program that started the session has no Screen Recording permission.
    return {
      remotePathHint: SHOT_NAME,
      command: `if screencapture -x -t png ${remote} 2>/dev/null && [ -s ${remote} ]; then printf '%s' ${remote}; else printf '${SCREEN_PERMISSION}'; exit 3; fi`,
    };
  }
  const shot = `command -v grim >/dev/null && grim ${remote} || command -v import >/dev/null && import -window root ${remote}`;
  return { remotePathHint: SHOT_NAME, command: `${shot} && printf '%s' ${remote}` };
}

export function transferDirCommand(os: RemoteSessionOs): string {
  if (os === "windows") {
    return windowsScriptCommand("$d=Join-Path $env:TEMP 'sagax-transfer'\nNew-Item -ItemType Directory -Force -Path $d | Out-Null\nWrite-Output $d");
  }
  return "d=\"$HOME/sagax-transfer\"; mkdir -p \"$d\" && printf '%s' \"$d\"";
}

export function deleteRemoteCommand(os: RemoteSessionOs, remotePath: string): string {
  if (os === "windows") {
    return windowsScriptCommand(`Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force`);
  }
  return `rm -f '${remotePath.replaceAll("'", "'\\''")}'`;
}

/** Stop file the end-user script watches, best effort. Same folders as the
 * Flow script (tailcat_session.py stop): %TEMP% or %ProgramData% (an
 * elevated session) on Windows, /tmp on macOS and Linux. The id is 12 hex. */
export function stopCommand(id: string, os: RemoteSessionOs): string {
  const safe = REMOTE_SESSION_ID.test(id) ? id : "000000000000";
  if (os === "windows") {
    return windowsScriptCommand(`foreach ($d in @((Join-Path $env:TEMP 'px-assist-${safe}'), (Join-Path $env:ProgramData 'px-assist-${safe}'))) { if (Test-Path -LiteralPath $d) { New-Item -ItemType File -Force -Path (Join-Path $d 'stop') | Out-Null } }`);
  }
  return `[ -d /tmp/px-assist-${safe} ] && : > /tmp/px-assist-${safe}/stop`;
}

/** One read-only look at the computer in a single call: OS, uptime and load,
 * memory, disk and the busiest processes. Fixed text, nothing interpolated. */
export function snapshotCommand(os: RemoteSessionOs): string {
  if (os === "windows") {
    return windowsScriptCommand([
      "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)",
      "$o=Get-CimInstance Win32_OperatingSystem",
      "'== os'; $o.Caption + ' ' + $o.Version + ' (' + $o.OSArchitecture + ')'",
      "'== uptime'; 'boot ' + $o.LastBootUpTime.ToString('s') + ', up ' + [math]::Round(((Get-Date)-$o.LastBootUpTime).TotalHours,1) + ' h'",
      "'== cpu'; Get-CimInstance Win32_Processor | ForEach-Object { $_.Name + ', load ' + $_.LoadPercentage + ' %' }",
      "'== memory'; 'total ' + [math]::Round($o.TotalVisibleMemorySize/1MB,1) + ' GB, free ' + [math]::Round($o.FreePhysicalMemory/1MB,1) + ' GB'",
      "'== disk'; Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID + ' free ' + [math]::Round($_.FreeSpace/1GB,1) + ' GB of ' + [math]::Round($_.Size/1GB,1) + ' GB' }",
      "'== top cpu'; Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Id,ProcessName,@{n='CPUs';e={[math]::Round($_.CPU,1)}},@{n='MB';e={[math]::Round($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String -Width 160",
      "'== top memory'; Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Id,ProcessName,@{n='MB';e={[math]::Round($_.WorkingSet64/1MB)}} | Format-Table -AutoSize | Out-String -Width 160",
    ].join("\n"));
  }
  if (os === "macos") {
    return [
      "echo '== os'; sw_vers | tr '\\n' ' '; uname -m",
      "echo '== uptime'; uptime",
      "echo '== cpu'; sysctl -n machdep.cpu.brand_string; echo \"cores $(sysctl -n hw.ncpu)\"",
      "echo '== memory'; echo \"total $(( $(sysctl -n hw.memsize) / 1073741824 )) GB\"; memory_pressure 2>/dev/null | tail -1; vm_stat | head -8",
      "echo '== disk'; df -h / /System/Volumes/Data 2>/dev/null",
      "echo '== top cpu'; ps -Ao pid,pcpu,pmem,comm -r | head -11",
      "echo '== top memory'; ps -Ao pid,pcpu,pmem,comm -m | head -11",
    ].join("; ");
  }
  return [
    "echo '== os'; ( . /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME\" ); uname -srm",
    "echo '== uptime'; uptime",
    "echo '== cpu'; awk -F: '/model name/{print $2; exit}' /proc/cpuinfo; echo \"cores $(nproc 2>/dev/null)\"",
    "echo '== memory'; free -m 2>/dev/null || head -3 /proc/meminfo",
    "echo '== disk'; df -h -x tmpfs -x devtmpfs 2>/dev/null || df -h",
    "echo '== top cpu'; ps -eo pid,pcpu,pmem,comm --sort=-pcpu | head -11",
    "echo '== top memory'; ps -eo pid,pcpu,pmem,comm --sort=-pmem | head -11",
  ].join("; ");
}

export function tailcatPtyArgv(bin: string, keyPath: string, address: string): string[] {
  return [bin, "ssh", "--key", keyPath, address];
}

export function tailcatSshArgv(bin: string, keyPath: string, address: string, command: string): string[] {
  return [...tailcatPtyArgv(bin, keyPath, address), command];
}

export function tailcatCopyArgv(bin: string, keyPath: string, from: string, to: string): string[] {
  return [bin, "cp", "--key", keyPath, from, to];
}

/** The environment of every tailcat call. `tailcat ssh` and `tailcat cp`
 * exec the system ssh client with its own options (ProxyCommand through
 * tailcat, StrictHostKeyChecking no and UserKnownHostsFile /dev/null: the
 * peer is already authenticated by its node key in the WireGuard tunnel,
 * LogLevel ERROR), and the remote command travels as one argument with no
 * local shell (execFile), parsed once by the remote shell. Extra ssh options
 * cannot be passed (anything after the address is the remote command), so
 * the server's ssh agent is kept out here: no SSH_AUTH_SOCK, no agent to
 * offer or forward. The server image holds no ssh identity of its own. */
export function tailcatEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.SSH_AUTH_SOCK;
  delete out.SSH_AGENT_PID;
  return out;
}

export const runCommand: RunCommand = (argv, timeoutMs) => new Promise((resolve) => {
  execFile(argv[0]!, argv.slice(1), { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: "utf8", env: tailcatEnv() }, (error, stdout, stderr) => {
    const failed = error as { code?: number; killed?: boolean; signal?: string | null } | null;
    const code = typeof failed?.code === "number" ? failed.code : error ? 1 : 0;
    const timedOut = Boolean(failed && (failed.killed || failed.signal === "SIGTERM") && typeof failed.code !== "number");
    resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "", ...(timedOut ? { timedOut } : {}) });
  });
});


