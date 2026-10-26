// Lists one folder of a Tailcat remote computer, read only. The command text
// is fixed: the folder path travels as base64 data (an argument of `sh` on
// macOS and Linux, a string literal of an -EncodedCommand script on Windows),
// so no character of it is ever read as shell or PowerShell syntax.
import { parseRemoteListing, REMOTE_LIST_MAX, type RemoteListing } from "../shared/remote-files.ts";
import type { RemoteSessionOs } from "../shared/remote-session.ts";
import type { CommandResult } from "./remote-session-probe.ts";

export const LIST_TIMEOUT_MS = 20_000;

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const shQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const UNIX_DECODE = "p=$(printf %s \"$1\" | base64 -d 2>/dev/null || printf %s \"$1\" | base64 -D 2>/dev/null)";

// $1 is the folder, base64. Hidden entries (dot files) are left out. Folders
// are listed in a first pass and files in a second, each in name order, so
// the cap cuts files before it ever cuts a folder.
const UNIX_SCRIPT = [
  UNIX_DECODE,
  "[ -n \"$p\" ] || p=\"$HOME\"",
  "[ -e \"$p\" ] || { printf 'ERR\\tnotfound\\n'; exit 0; }",
  "[ -d \"$p\" ] || { printf 'ERR\\tnotdir\\n'; exit 0; }",
  "cd -- \"$p\" 2>/dev/null || { printf 'ERR\\tdenied\\n'; exit 0; }",
  "[ -r . ] || { printf 'ERR\\tdenied\\n'; exit 0; }",
  "printf 'PWD\\t%s\\nHOME\\t%s\\nROOT\\t/\\n' \"$(pwd -P)\" \"$HOME\"",
  "T=$(printf '\\t'); NL=$(printf '\\nx'); NL=${NL%x}; n=0; more=",
  "for pass in d f; do",
  "  [ -n \"$more\" ] && break",
  "  for f in *; do",
  "    [ -e \"$f\" ] || [ -L \"$f\" ] || continue",
  "    case \"$f\" in *\"$T\"*|*\"$NL\"*) continue;; esac",
  "    if [ -d \"$f\" ]; then k=d; else k=f; fi",
  "    [ \"$k\" = \"$pass\" ] || continue",
  `    n=$((n+1)); if [ "$n" -gt ${REMOTE_LIST_MAX} ]; then printf 'MORE\\n'; more=1; break; fi`,
  "    st=$(stat -L -c '%s %Y' -- \"$f\" 2>/dev/null || stat -L -f '%z %m' -- \"$f\" 2>/dev/null)",
  "    case \"$st\" in *' '*) sz=${st% *}; mt=${st#* };; *) sz=; mt=;; esac",
  "    printf '%s\\t%s\\t%s\\t%s\\n' \"$k\" \"$sz\" \"$mt\" \"$f\"",
  "  done",
  "done",
].join("\n");

function windowsScript(pathB64: string): string {
  // pathB64 is [A-Za-z0-9+/=] only, so it is safe inside the single quotes.
  return [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)",
    `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathB64}'))`,
    "if(-not $p){$p=$env:USERPROFILE}",
    "try{$i=Get-Item -LiteralPath $p -Force}catch [System.UnauthorizedAccessException]{\"ERR`tdenied\";exit}catch{\"ERR`tnotfound\";exit}",
    "if(-not $i.PSIsContainer){\"ERR`tnotdir\";exit}",
    "try{$items=@(Get-ChildItem -LiteralPath $i.FullName -ErrorAction Stop)}catch{\"ERR`tdenied\";exit}",
    "\"PWD`t\"+$i.FullName",
    "\"HOME`t\"+$env:USERPROFILE",
    "foreach($d in [IO.DriveInfo]::GetDrives()){if($d.IsReady){\"ROOT`t\"+$d.Name}}",
    "$e=0",
    "$items=@($items|Where-Object{$_.PSIsContainer}|Sort-Object Name)+@($items|Where-Object{-not $_.PSIsContainer}|Sort-Object Name)",
    "foreach($c in $items){",
    ` $e++; if($e -gt ${REMOTE_LIST_MAX}){'MORE';break}`,
    " $m=[int64](($c.LastWriteTimeUtc-[datetime]'1970-01-01').TotalSeconds)",
    " if($c.PSIsContainer){\"d`t0`t$m`t\"+$c.Name}else{\"f`t\"+$c.Length+\"`t$m`t\"+$c.Name}",
    "}",
  ].join("\n");
}

/** The command that lists `dir` ("" = the person's profile). `dir` must
 * already have passed safeRemoteDir; it never appears in the text as is. */
export function listDirCommand(os: RemoteSessionOs, dir: string): string {
  const pathB64 = b64(dir);
  if (os === "windows") {
    const encoded = Buffer.from(windowsScript(pathB64), "utf16le").toString("base64");
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
  }
  return `sh -c ${shQuote(UNIX_SCRIPT)} sagax-ls ${pathB64 || "''"}`;
}

/** Asks whether `file` (already validated) exists, as `yes` or `no`. A
 * broken link counts as there: scp would write through it. */
export function existsCommand(os: RemoteSessionOs, file: string): string {
  const pathB64 = b64(file);
  if (os === "windows") {
    const script = [
      "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)",
      `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathB64}'))`,
      "if(Test-Path -LiteralPath $p){'yes'}else{'no'}",
    ].join("\n");
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  }
  const script = [UNIX_DECODE, "if [ -e \"$p\" ] || [ -L \"$p\" ]; then printf yes; else printf no; fi"].join("\n");
  return `sh -c ${shQuote(script)} sagax-exists ${pathB64}`;
}

/** true / false, or null when the computer did not say. */
export function readExists(result: CommandResult | null): boolean | null {
  if (!result || result.code !== 0) return null;
  const answer = result.stdout.trim();
  return answer === "yes" ? true : answer === "no" ? false : null;
}

/** `ssh` exits 255 when the tunnel itself failed. */
const TRANSPORT_FAILED = 255;

export type ListResult = { listing: RemoteListing } | { status: number; error: string };

/** What the listing command answered, as the route returns it. */
export function readListing(result: CommandResult | null, os: RemoteSessionOs): ListResult {
  if (!result || result.code === TRANSPORT_FAILED) return { status: 409, error: "The remote computer did not answer. Try again in a moment." };
  const parsed = parseRemoteListing(result.stdout, os);
  if ("error" in parsed) {
    if (parsed.error === "notfound") return { status: 404, error: "That folder does not exist on the remote computer." };
    if (parsed.error === "notdir") return { status: 400, error: "That path is a file, not a folder." };
    if (parsed.error === "denied") return { status: 409, error: "The remote computer refused to open that folder." };
    return { status: 409, error: "The remote computer did not list that folder." };
  }
  return { listing: parsed };
}
