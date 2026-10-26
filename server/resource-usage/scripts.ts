// The read-only commands a resource sampler runs. The text is ours: nothing
// the person or the model typed is ever put into it. Each sample prints one
// block, `@@begin` ... `@@end`, made of `@@<section>` parts that parse.ts reads.
// Nothing is installed, written or changed on the computer.

export type ScriptFamily = "posix" | "windows";

/** One sample on macOS or Linux (the computer says which with uname). */
const POSIX_SAMPLE = [
  "echo @@begin",
  "os=$(uname -s 2>/dev/null)",
  "echo @@os",
  "echo \"$os\"",
  "echo @@host",
  "hostname 2>/dev/null",
  "if [ \"$os\" = Darwin ]; then",
  "  echo \"$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)\"",
  "  echo @@ncpu; sysctl -n hw.ncpu 2>/dev/null",
  "  echo @@boottime; sysctl -n kern.boottime 2>/dev/null; date +%s",
  // two top samples one second apart: the second is the last second's CPU
  "  echo @@cpu; top -l 2 -n 0 -s 1 2>/dev/null | grep \"^CPU usage\" | tail -1",
  "  echo @@vmstat; vm_stat 2>/dev/null",
  "  echo @@memsize; sysctl -n hw.memsize 2>/dev/null",
  "  echo @@swap; sysctl -n vm.swapusage 2>/dev/null",
  "  echo @@ioreg; ioreg -c IOBlockStorageDriver -r -w 0 -d 1 2>/dev/null | grep \"\\\"Statistics\\\"\"",
  "  echo @@netstat; netstat -ibn 2>/dev/null",
  "  echo @@df; df -kP -l 2>/dev/null",
  "else",
  "  if [ -r /etc/os-release ]; then (. /etc/os-release; echo \"${PRETTY_NAME:-Linux}\"); else uname -sr; fi",
  "  echo @@uptime; cat /proc/uptime 2>/dev/null",
  "  echo @@stat; grep \"^cpu\" /proc/stat 2>/dev/null",
  "  echo @@meminfo; cat /proc/meminfo 2>/dev/null",
  "  echo @@diskstats; cat /proc/diskstats 2>/dev/null",
  "  echo @@netdev; cat /proc/net/dev 2>/dev/null",
  "  echo @@df; df -kP 2>/dev/null",
  "fi",
  "echo @@end",
].join("\n");

/** One sample on Windows. CIM performance classes read the same on a French
 * or an English Windows (Get-Counter paths are translated), and a standard
 * user may read them: no administrator rights needed. */
const WINDOWS_SAMPLE = [
  "$o = Get-CimInstance Win32_OperatingSystem",
  "'@@begin'",
  "'@@os'; 'Windows'",
  "'@@host'; $env:COMPUTERNAME; $o.Caption",
  "'@@uptime'; [int]((Get-Date) - $o.LastBootUpTime).TotalSeconds",
  "'@@cpu'; Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | ForEach-Object { [string]$_.Name + '=' + $_.PercentProcessorTime }",
  "'@@mem'; 'total=' + $o.TotalVisibleMemorySize; 'free=' + $o.FreePhysicalMemory",
  "'@@swap'; Get-CimInstance Win32_PageFileUsage | ForEach-Object { 'size=' + $_.AllocatedBaseSize + ' used=' + $_.CurrentUsage }",
  "'@@disk'; Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -eq '_Total' } | ForEach-Object { 'read=' + $_.DiskReadBytesPersec; 'write=' + $_.DiskWriteBytesPersec }",
  "'@@net'; Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | ForEach-Object { 'rx=' + $_.BytesReceivedPersec + ' tx=' + $_.BytesSentPersec }",
  "'@@df'; Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [string]$_.DeviceID + ' ' + $_.Size + ' ' + $_.FreeSpace }",
  "'@@end'",
].join("\n");

const bounded = (iterations: number) => Math.max(1, Math.min(600, Math.floor(iterations)));

/** `iterations` samples, about two seconds apart, then the loop ends by
 * itself: a sampler the server lost still stops on the computer. */
export function posixLoop(iterations: number): string {
  return [
    "i=0",
    `while [ "$i" -lt ${bounded(iterations)} ]; do`,
    POSIX_SAMPLE,
    // top already took one second on macOS
    "if [ \"$os\" = Darwin ]; then sleep 1; else sleep 2; fi",
    "i=$((i+1))",
    "done",
  ].join("\n");
}

export function windowsLoop(iterations: number): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$ProgressPreference = 'SilentlyContinue'",
    `for ($i = 0; $i -lt ${bounded(iterations)}; $i++) {`,
    WINDOWS_SAMPLE,
    "[Console]::Out.Flush()",
    "Start-Sleep -Seconds 2",
    "}",
  ].join("\n");
}

export function loopScript(family: ScriptFamily, iterations: number): string {
  return family === "windows" ? windowsLoop(iterations) : posixLoop(iterations);
}

/** PowerShell reads the script as UTF-16LE base64: no quoting survives cmd.exe and ssh otherwise. */
export function encodedPowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function powershellArgv(script: string): string[] {
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShell(script)];
}

export function shQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** One command line for a remote shell (ssh, tailcat ssh): `sh -c '<loop>'`
 * whatever the login shell is, or PowerShell with an encoded script. */
export function remoteCommand(family: ScriptFamily, iterations: number): string {
  if (family === "windows") return powershellArgv(windowsLoop(iterations)).join(" ");
  return `sh -c ${shQuote(posixLoop(iterations))}`;
}

/** argv for this computer. */
export function localArgv(family: ScriptFamily, iterations: number): string[] {
  if (family === "windows") return powershellArgv(windowsLoop(iterations));
  return ["/bin/sh", "-c", posixLoop(iterations)];
}
