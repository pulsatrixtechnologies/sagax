// The user-mode helper that runs on the end user's computer, over the tunnel
// a stage-1 session already established, to give the technician live control.
// It is delivered in the session command itself (no helper binary shipped):
// on Windows a short PowerShell program whose input loop and screen capture
// are compiled C# (Add-Type), so it injects with SendInput and captures with
// CopyFromScreen at standard rights, in the user's own session. It exits when
// its stdin closes (control released or session closed), when the end-user
// script's stop file appears, or at a hard deadline. The server never
// interpolates anything the person typed into this script: only the bounded
// values below.
//
// It writes no files of its own; note that `Add-Type` compiles to the user's
// temp folder and that PowerShell script-block logging (event 4104), if an
// admin turned it on, records the script, and that antivirus may inspect an
// `-EncodedCommand` or an `Add-Type` build. The end-user console window and
// the on-screen notice keep the session visible and consented.
import type { RemoteSessionOs } from "../shared/remote-session.ts";

export interface ControlHelperOptions {
  /** Frames per second, 2..15. */
  fps: number;
  /** JPEG quality, 30..90. */
  quality: number;
  /** Hard stop in seconds, so an orphaned helper cannot outlive the session. */
  maxSeconds: number;
  /** The 12-hex session id, so the helper watches the end-user script's stop file. */
  sessionId: string;
  /** Who is in control, shown in the on-screen notice. Trimmed, bounded, no newlines. */
  technician?: string;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** True when live control is available for this OS. Windows only for now;
 * macOS and Linux would need a tool we do not ship, so the screen there stays
 * read-only (the signed helper app, a JC decision, will cover all three). */
export function controlSupported(os: RemoteSessionOs): boolean {
  return os === "windows";
}

const SESSION_ID = /^[0-9a-f]{12}$/;

/** A short bootstrap and the real script. The bootstrap is the tunnel command
 * (tiny, so no cmd.exe length limit); it reads the base64 script from the
 * first stdin line and runs it, and the script then reads the input events
 * from the rest of stdin. Returns null when this OS has no control path. */
export function controlHelperCommand(os: RemoteSessionOs, options: ControlHelperOptions): { command: string; script: string; preamble: string } | null {
  if (os !== "windows") return null;
  const script = windowsControlScript(options);
  const scriptB64 = Buffer.from(script, "utf8").toString("base64");
  // The command run over the tunnel stays small: it reads one base64 line
  // (the program) from stdin and runs it. Delivering the program on stdin
  // avoids any cmd.exe argument-length limit on the remote side.
  const bootstrap = "$ErrorActionPreference='Stop';$b=[Console]::In.ReadLine();Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)))";
  // Encoded, never in a double-quoted -Command: the session shell on Windows
  // is PowerShell, which would expand $b before the inner one runs.
  const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(bootstrap, "utf16le").toString("base64")}`;
  return { command, script, preamble: `${scriptB64}\n` };
}

function psString(value: string): string {
  // A PowerShell single-quoted literal: double any single quote; strip control chars.
  // oxlint-disable-next-line no-control-regex -- the notice text keeps no control characters
  return `'${value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/'/g, "''")}'`;
}

export function windowsControlScript(options: ControlHelperOptions): string {
  const fps = clampInt(options.fps, 2, 15);
  const quality = clampInt(options.quality, 30, 90);
  const maxSeconds = clampInt(options.maxSeconds, 1, 26 * 60 * 60);
  const frameInterval = Math.max(1, Math.round(1000 / fps));
  const sessionId = SESSION_ID.test(options.sessionId) ? options.sessionId : "000000000000";
  const noticeText = (options.technician?.trim() ? `Contrôle à distance en cours : ${options.technician.trim()}` : "Contrôle à distance en cours").slice(0, 120);
  const notice = psString(noticeText);
  // The input loop and the SendInput surface are compiled C# so they run on a
  // plain background thread with no PowerShell runspace (Windows PowerShell 5.1
  // has none for a scriptblock thread). The C# reads stdin itself.
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class PxInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  const uint MOUSE=0, KEYBD=1;
  const uint MOVE=0x0001, ABSOLUTE=0x8000, VIRTUALDESK=0x4000, LDOWN=0x0002, LUP=0x0004, RDOWN=0x0008, RUP=0x0010, MDOWN=0x0020, MUP=0x0040, WHEEL=0x0800;
  const uint KEYUP=0x0002, UNICODE=0x0004;
  const int SM_XVIRTUALSCREEN=76, SM_YVIRTUALSCREEN=77, SM_CXVIRTUALSCREEN=78, SM_CYVIRTUALSCREEN=79;
  public static volatile bool Stop = false;

  public static void SetDpi() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } }
  }
  static void Mouse(uint flags, int dx, int dy, uint data) {
    INPUT[] a = new INPUT[1]; a[0].type = MOUSE; a[0].u.mi.dwFlags = flags; a[0].u.mi.dx = dx; a[0].u.mi.dy = dy; a[0].u.mi.mouseData = data;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  static void Key(ushort vk, bool up) {
    INPUT[] a = new INPUT[1]; a[0].type = KEYBD; a[0].u.ki.wVk = vk; a[0].u.ki.dwFlags = up ? KEYUP : 0;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  static void Unicode(char c, bool up) {
    INPUT[] a = new INPUT[1]; a[0].type = KEYBD; a[0].u.ki.wScan = c; a[0].u.ki.dwFlags = UNICODE | (up ? KEYUP : 0);
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  static void Move(int nx, int ny) {
    // normalized 0..10000 -> absolute 0..65535 across the whole virtual desktop
    // (ABSOLUTE | VIRTUALDESK maps 0..65535 onto the full multi-monitor extent).
    int sx = (int)Math.Round((nx / 10000.0) * 65535.0);
    int sy = (int)Math.Round((ny / 10000.0) * 65535.0);
    Mouse(MOVE | ABSOLUTE | VIRTUALDESK, sx, sy, 0);
  }
  static int ParseInt(string s) { int v; return int.TryParse(s, out v) ? v : 0; }
  // Read input events from stdin until EOF, injecting each. One fixed shape
  // per line; nothing is evaluated. On EOF the helper is told to stop.
  public static void PumpInput() {
    TextReader stdin = Console.In;
    string line;
    while ((line = stdin.ReadLine()) != null) {
      try {
        line = line.Trim();
        if (line.Length == 0) continue;
        int sp = line.IndexOf(' ');
        string op = sp < 0 ? line : line.Substring(0, sp);
        string rest = sp < 0 ? "" : line.Substring(sp + 1);
        if (op == "m") { string[] p = rest.Split(' '); if (p.Length == 2) Move(ParseInt(p[0]), ParseInt(p[1])); }
        else if (op == "d") { int b = ParseInt(rest); Mouse(b == 0 ? LDOWN : b == 1 ? RDOWN : MDOWN, 0, 0, 0); }
        else if (op == "u") { int b = ParseInt(rest); Mouse(b == 0 ? LUP : b == 1 ? RUP : MUP, 0, 0, 0); }
        else if (op == "w") { int d = ParseInt(rest); Mouse(WHEEL, 0, 0, unchecked((uint)(d * 120))); }
        else if (op == "k") { string[] p = rest.Split(' '); if (p.Length == 2) Key((ushort)ParseInt(p[0]), ParseInt(p[1]) == 0); }
        else if (op == "x") { string s = PxJson.Unquote(rest); for (int i = 0; i < s.Length; i++) { Unicode(s[i], false); Unicode(s[i], true); } }
      } catch { }
    }
    Stop = true;
  }
}
public static class PxJson {
  // Minimal JSON-string unescape for the one "x <json string>" event.
  public static string Unquote(string raw) {
    raw = raw.Trim();
    if (raw.Length < 2 || raw[0] != '"') return "";
    System.Text.StringBuilder sb = new System.Text.StringBuilder();
    for (int i = 1; i < raw.Length; i++) {
      char c = raw[i];
      if (c == '"') break;
      if (c == '\\' && i + 1 < raw.Length) {
        char n = raw[++i];
        if (n == 'n') sb.Append('\n'); else if (n == 't') sb.Append('\t'); else if (n == 'r') sb.Append('\r');
        else if (n == 'u' && i + 4 < raw.Length) { int code = Convert.ToInt32(raw.Substring(i + 1, 4), 16); sb.Append((char)code); i += 4; }
        else sb.Append(n);
      } else sb.Append(c);
    }
    return sb.ToString();
  }
}
"@

[PxInput]::SetDpi()
$deadline = (Get-Date).AddSeconds(${maxSeconds})
$stopFile = Join-Path $env:TEMP ('px-assist-${sessionId}\stop')

# A small always-on-top notice on the end user's screen, so control is never
# silent. It lives on its own thread and closes when the helper exits.
$noticeThread = [System.Threading.Thread]::new([System.Threading.ThreadStart]{
  try {
    $f = New-Object System.Windows.Forms.Form
    $f.FormBorderStyle = 'None'; $f.TopMost = $true; $f.ShowInTaskbar = $false
    $f.StartPosition = 'Manual'; $f.BackColor = [System.Drawing.Color]::FromArgb(250, 211, 100)
    $f.Width = 360; $f.Height = 34
    $f.Left = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width - $f.Width - 16; $f.Top = 16
    $l = New-Object System.Windows.Forms.Label
    $l.Dock = 'Fill'; $l.TextAlign = 'MiddleCenter'; $l.Text = ${notice}
    $l.ForeColor = [System.Drawing.Color]::FromArgb(49, 55, 55)
    $f.Controls.Add($l)
    $t = New-Object System.Windows.Forms.Timer; $t.Interval = 500
    $t.add_Tick({ if ([PxInput]::Stop) { $f.Close() } })
    $t.Start()
    [System.Windows.Forms.Application]::Run($f)
  } catch { }
})
$noticeThread.SetApartmentState([System.Threading.ApartmentState]::STA)
$noticeThread.IsBackground = $true
$noticeThread.Start()

$inputThread = [System.Threading.Thread]::new([System.Threading.ThreadStart]{ [PxInput]::PumpInput() })
$inputThread.IsBackground = $true
$inputThread.Start()

$out = [Console]::OpenStandardOutput()
function Write-Frame([byte]$type, [byte[]]$payload) {
  $len = $payload.Length
  $header = [byte[]]@($type, (($len -shr 24) -band 0xFF), (($len -shr 16) -band 0xFF), (($len -shr 8) -band 0xFF), ($len -band 0xFF))
  $out.Write($header, 0, 5); if ($len -gt 0) { $out.Write($payload, 0, $len) }; $out.Flush()
}

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${quality})

$lastW = 0; $lastH = 0; $lastHash = $null
$sha = [System.Security.Cryptography.SHA1]::Create()
# One capture loop. It ends on the deadline, when input stops (stdin EOF), or
# when the end-user script's stop file appears.
while ((Get-Date) -lt $deadline -and -not [PxInput]::Stop) {
  if (Test-Path -LiteralPath $stopFile) { break }
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $w = [Math]::Max(1, $b.Width); $h = [Math]::Max(1, $b.Height)
  if ($w -ne $lastW -or $h -ne $lastH) {
    $meta = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress @{ w = $w; h = $h }))
    Write-Frame 0x4D $meta
    $lastW = $w; $lastH = $h
  }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $jpeg, $params)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    $hash = [Convert]::ToBase64String($sha.ComputeHash($bytes))
    if ($hash -ne $lastHash) { Write-Frame 0x46 $bytes; $lastHash = $hash }
  } finally { $g.Dispose(); $bmp.Dispose() }
  Start-Sleep -Milliseconds ${frameInterval}
}
[PxInput]::Stop = $true
`;
}
