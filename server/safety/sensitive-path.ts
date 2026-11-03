// Which paths of a person's server environment hold credentials or secrets
// (2026-10-17, leftovers of the #688/#689/#690 security review). Pure: no
// disk; the environment is another machine, so its links are resolved there
// (server/sandbox/user-sandbox-tools.ts resolveInSandbox) and the answers come back
// here.
//
// Three readings:
// - sensitiveEnvironmentPath: the name check the owner's environment
//   applies before a read runs without a card (member-environment.ts
//   ownEnvironmentSensitiveRead): a `.`-name or `..` anywhere, a key or
//   credentials file name, or a process secret under /proc;
// - procSecretPath: /proc/<pid|self|thread-self>[/task/<tid>]/environ,
//   cmdline, mem (and the links fd, root, cwd, exe, map_files that lead
//   anywhere): the environment variables and memory of a process, where the
//   person's tokens live. Never read through read_file or list_files;
// - credentialLocation: where a symbolic link must never lead (a component
//   of a read that is a link into `.ssh`, `.git-credentials`,
//   `.config/gh`, `.aws`...): the read is refused, whoever asked.
//
// Hard links (2026-10-17, leftovers of #694/#701): a hard link has no
// target to follow, so the environment lists the file's other names
// (`aliases`, user-sandbox-tools.ts RESOLVE_SCRIPT) when a regular file of
// the sandbox user has more than one; a name in a credential location, or
// a dotfile, refuses the call, and a list that could not be completed fails
// closed. Root-owned files are skipped there: an inode has one owner, so a
// root-owned file is never a hard link to the person's credentials.
// Bind mounts cannot be made from inside the environment (no capability,
// no-new-privileges, the runtime's seccomp profile): the only mounts are the
// provisioner's own (docs/user-sandbox.md).

import { sagaxFolder } from "../../shared/human-id.ts";

/** A file name that holds credentials even without a leading dot. */
export const CREDENTIAL_NAME = /^(?:credentials?(?:\.[a-z]+)?|hosts\.yml|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|[^/]*\.(?:pem|key|p12|pfx|kdbx|keychain(?:-db)?)|kubeconfig|secrets?(?:\.[a-z]+)?|token(?:s)?(?:\.[a-z]+)?)$/i;

/** Dot folders and files that hold a login, a key or a token. */
const CREDENTIAL_DOTNAME = /^\.(?:ssh|gnupg|aws|azure|kube|docker|netrc|npmrc|pypirc|git-credentials|gitconfig|env(?:\..*)?|password-store|vault-token|pgpass|my\.cnf)$/i;

/** Credential folders under .config. */
const CREDENTIAL_CONFIG = /^(?:gh|gcloud|hub|git|op|rclone|doctl|helm)$/i;

const PROC_SECRET = /^\/proc\/[^/]+(?:\/task\/[^/]+)?\/(?:environ|cmdline|mem|fd|root|cwd|exe|map_files|maps|auxv|stack|syscall)(?:\/|$)/;
const DEV_FD = /^\/dev\/(?:fd|stdin|stdout|stderr)(?:\/|$)/;

/** The path's lexical parts: `~` is the home, repeated slashes count once. */
function partsOf(path: string): string[] {
  return path.trim().replace(/^~(?=\/|$)/, "").split(/[\\/]+/).filter(Boolean);
}

/** The path as one absolute string, lexically (no link is followed). */
function lexical(path: string): string {
  return `/${partsOf(path).join("/")}`;
}

/** Whether a path names a process's secrets under /proc (or a descriptor
 * link under /dev/fd that leads to one). */
export function procSecretPath(path: string): boolean {
  if (!path.trim().startsWith("/")) return false;
  const flat = lexical(path);
  return PROC_SECRET.test(flat) || DEV_FD.test(flat);
}

/** Whether a resolved path lies in a credential location. */
export function credentialLocation(path: string): boolean {
  if (procSecretPath(path)) return true;
  const parts = partsOf(path);
  return parts.some((part, index) => CREDENTIAL_NAME.test(part) || CREDENTIAL_DOTNAME.test(part)
    || (part === ".config" && CREDENTIAL_CONFIG.test(parts[index + 1] ?? "")));
}

/** Whether the last part of a path is a dotfile name. */
function hiddenName(path: string): boolean {
  return partsOf(path).at(-1)?.startsWith(".") ?? false;
}

/** Whether a read of this path needs a card even in the owner's own
 * environment for a turn that is not the owner's own: a dotfile, a `..`, a
 * credential name, a percent-encoded name or a process secret. */
export function sensitiveEnvironmentPath(path: string): boolean {
  // a percent-encoded or otherwise escaped name is not read here
  if (/%[0-9a-f]{2}/i.test(path)) return true;
  if (procSecretPath(path)) return true;
  return partsOf(path).some((part) => part.startsWith(".") || CREDENTIAL_NAME.test(part));
}

/** What the environment answered about one path (resolveInSandbox). */
export interface ResolvedEnvironmentPath {
  /** The path with every link followed (a missing tail kept as written). */
  real: string;
  /** For each component of the path that is a symbolic link, where it
   * leads (resolved). */
  links: string[];
  /** The opened object's identity (`dev:ino`), checked again when the file
   * is opened (null: nothing there yet). */
  id?: string | null;
  /** The other names of a regular file with more than one hard link. */
  aliases?: string[];
  /** False when those names could not all be found (an unreadable folder,
   * too many entries): the call fails closed. */
  aliasesComplete?: boolean;
}

/** Why a read of `requested`, resolved as `resolved`, is refused, or null.
 * A process secret is never read; a link in any component that leads into
 * a credential location is refused; and a path whose name looked ordinary
 * but whose real place is sensitive (a link laundering a dotfile) is
 * refused, since its card (or its absence) was decided on the name. */
export function resolvedReadRefusal(requested: string, resolved: ResolvedEnvironmentPath): string | null {
  if (procSecretPath(requested) || procSecretPath(resolved.real)) {
    return "This path holds a process's environment or memory (/proc). It is never read here.";
  }
  if (resolved.links.some((target) => credentialLocation(target))) {
    return "A symbolic link in this path leads to a credential location. It is not followed; name the real path instead.";
  }
  if (!sensitiveEnvironmentPath(requested) && sensitiveEnvironmentPath(resolved.real)) {
    return "This path leads through a symbolic link to a dotfile or a credential path. It is not followed; name the real path instead.";
  }
  // A hard link: a name that is already sensitive got its card on that
  // name; an ordinary one must not lead to a dotfile or a credential file.
  if (!sensitiveEnvironmentPath(requested)) {
    if (resolved.aliasesComplete === false) {
      return "This file has other hard links that could not all be checked, so it is not used here.";
    }
    if ((resolved.aliases ?? []).some((alias) => credentialLocation(alias) || hiddenName(alias))) {
      return "This file is a hard link to a dotfile or a credential file. It is not used here; name the real path instead.";
    }
  }
  return null;
}

/** Whether a read of this path in the owner's own environment is a
 * sensitive one (member-environment.ts ownEnvironmentSensitiveRead reads
 * the same way): the bot's own Sagax-made workspace root is not a
 * credential (its data folder begins with a dot), only a credential path
 * below it is. */
export function sensitiveReadPath(path: string): boolean {
  const made = sagaxFolder(path);
  if (made) return made.rest.length > 0 && sensitiveEnvironmentPath(made.rest.join("/"));
  return sensitiveEnvironmentPath(path);
}
