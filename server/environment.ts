// What a client learns about this server before it authenticates: a stable
// identity, a label, the version, and what it can do. Served without auth at
// /.well-known/openmausbot/environment so a saved connection can check it is
// still talking to the same server, and so version skew is visible.
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import { SERVER_FEATURE_NAMES, type ServerFeature } from "../shared/server-features.ts";
import type { IdentityDescriptor } from "./auth/oidc-login.ts";
import { SERVER_ROOT } from "./proxy-paths.ts";

export interface EnvironmentDescriptor {
  environmentId: string;
  label: string;
  platform: NodeJS.Platform;
  /** The base version (package.json `version`): the same on every Sagax
   * release, so never a way to tell what this server serves. */
  version: string;
  /** The Sagax release people know (releaseVersion()). Absent on a server
   * from before 2026-10-28. */
  release?: string;
  capabilities: {
    /** Pairing and sessions are available (this build). */
    remoteSessions: true;
    /** This server accepts computer sharing. Present only while the
     * maintainer flag `features.sharedComputers` is on: a server with it off
     * advertises nothing, exactly like a build that predates the feature. */
    sharedComputers?: true;
    /** A person's own OMB Cloud home (docs/cloud-pro.md). Absent elsewhere. */
    cloudHome?: true;
    /** Who can update the server: the desktop app that runs it, or the operator. */
    selfUpdate: "desktop-managed" | "operator";
    /** Whether /pair offers "sign in with your email" (an allow-list is set). */
    emailSignIn?: boolean;
    /** POST /api/auth/pair with `preview: true` (no `browser`) only reads
     * whose a sign-in credential is and redeems nothing. A server without
     * this flag (0.4.x, 0.5.0) redeems the credential on that request, so a
     * client must never send it there. */
    signInPreview?: true;
    /** The routes this server serves, by feature (shared/server-features.ts,
     * 2026-10-28). A newer app hides or disables a feature this list does
     * not name. A server without the list predates it. */
    features?: ServerFeature[];
  };
  /** Present on an organization server: people sign in with Perspicax
   * (OpenID Connect) at `loginPath`, and email codes are off. */
  identity?: IdentityDescriptor;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function readEnvironmentId(file: string): string | undefined {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw new Error(`Cannot read the existing environment identity at ${file}; refusing to replace it.`, {
      cause: error,
    });
  }

  const id = contents.trim();
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`The existing environment identity at ${file} is not a valid UUID; refusing to replace it.`);
  }
  return id;
}

/** Read or create the id. Written once, never rotated by the server itself. */
export function loadEnvironmentId(dataDir: string): string {
  const file = join(dataDir, "environment-id");
  const existing = readEnvironmentId(file);
  if (existing) return existing;

  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const id = randomUUID();
  const temporaryFile = join(directory, `.environment-id.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;

  try {
    descriptor = openSync(temporaryFile, "wx", 0o600);
    writeFileSync(descriptor, id + "\n", "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    try {
      // The temporary file is complete before it becomes visible at the final
      // path. A hard link is an atomic, no-replace publish on every supported
      // desktop platform, unlike rename (which overwrites on POSIX).
      linkSync(temporaryFile, file);
      return id;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const winner = readEnvironmentId(file);
      if (winner) return winner;
      throw new Error(`The environment identity at ${file} disappeared while it was being created.`);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporaryFile);
    } catch {
      // A leftover private temporary file is harmless and must not make a
      // successfully published identity unusable.
    }
  }
}

let stamp: string | undefined;
/** This server's release and, on a Cloud, its image: what it runs changes with either, the engines' CLIs included. */
export function buildStamp(): string {
  stamp ??= [serverVersion(), process.env.SAGAX_CLOUD_IMAGE?.trim()].filter(Boolean).join(" ");
  return stamp;
}

/** A version field of the bundle's own version.json (written beside index.js
 * by scripts/bundle-server.mjs), else of the checkout's package.json one level
 * up. The image ships dist-server/ without that package.json: reading only the
 * latter left /api/health at "unknown" in production (#2582). */
function packagedVersionField(root: string, field: "version" | "forkVersion"): string {
  for (const file of [join(root, "version.json"), join(root, "..", "package.json")]) {
    try {
      const pkg: unknown = JSON.parse(readFileSync(file, "utf8"));
      const value = Reflect.get(Object(pkg), field);
      if (typeof value === "string" && value) return value;
    } catch {
      /* not there: try the next one */
    }
  }
  return "";
}

/** The desktop app passes its own version; an image or a bundle reads its
 * version.json; a checkout reads package.json; SAGAX_APP_VERSION wins. */
export function serverVersion(root: string = SERVER_ROOT): string {
  const fromEnv = process.env.SAGAX_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  return packagedVersionField(root, "version") || "unknown";
}

/** The Sagax release people know (package.json `forkVersion`, 0.4.x), not
 * the base `version` the link sends (2026-10-08, console audit 6.3). An
 * image may set SAGAX_RELEASE_VERSION; else the bundle's or the package's
 * forkVersion; else serverVersion(). */
export function releaseVersion(root: string = SERVER_ROOT): string {
  const fromEnv = process.env.SAGAX_RELEASE_VERSION?.trim();
  if (fromEnv) return fromEnv.slice(0, 64);
  return packagedVersionField(root, "forkVersion") || serverVersion(root);
}

/** The version a linked server reports to Perspicax (X-Pulsabot-Version):
 * the release people know, or "" when this server cannot tell, so Perspicax
 * keeps the last good one. Never "0.0.0" nor "unknown": the old reading of
 * ../package.json beside the bundle sent "0.0.0" from every image, and
 * Perspicax's api_list showed it (QA 0.8.66 F7). */
export function linkVersion(root: string = SERVER_ROOT): string {
  const version = releaseVersion(root);
  return version === "unknown" || version === "0.0.0" ? "" : version;
}

/** This server's display name: SAGAX_ENVIRONMENT_LABEL, else the
 * organization's name (SAGAX_ORG_NAME), else the host of its public address
 * (SAGAX_PUBLIC_URL), else the machine's host name. A container's host name is
 * its id (say 2f463c19755e), never a name to show people. */
export function environmentLabel(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SAGAX_ENVIRONMENT_LABEL?.trim() || env.SAGAX_ORG_NAME?.trim();
  if (explicit) return explicit.slice(0, 120);
  try {
    const host = env.SAGAX_PUBLIC_URL?.trim() ? new URL(env.SAGAX_PUBLIC_URL.trim()).hostname : "";
    if (host) return host;
  } catch {
    /* not a URL: fall through */
  }
  return hostname();
}

export function environmentDescriptor(input: { environmentId: string; desktopManaged: boolean; emailSignIn?: boolean; sharedComputers?: boolean; cloudHome?: boolean; identity?: IdentityDescriptor }): EnvironmentDescriptor {
  return {
    environmentId: input.environmentId,
    label: environmentLabel(),
    platform: process.platform,
    version: serverVersion(),
    release: releaseVersion(),
    capabilities: {
      remoteSessions: true,
      // Never advertise a protocol this server would refuse: the routes are
      // gone unless features.sharedComputers is on, so the capability is too.
      ...(input.sharedComputers === true ? { sharedComputers: true as const } : {}),
      // An OMB Cloud home: its pairing page says "Opening your Cloud…" and
      // where to connect from, not "the code shown on the server".
      ...(input.cloudHome === true ? { cloudHome: true as const } : {}),
      selfUpdate: input.desktopManaged ? "desktop-managed" : "operator",
      emailSignIn: input.emailSignIn === true,
      signInPreview: true,
      features: [...SERVER_FEATURE_NAMES],
    },
    ...(input.identity ? { identity: input.identity } : {}),
  };
}
