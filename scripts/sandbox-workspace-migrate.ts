// Copy one person's server-environment workspace between the Docker volume
// and the Kubernetes PVC. The bytes move only between the two directories
// named here. The source directory is read and left as it was. A second run
// with the same bytes copies nothing.
//
// Mount the volume and the claim yourself, read-only for the source:
//
//   docker run --rm -v sagax-user-<key>-workspace:/workspace:ro -v "$PWD/stage:/out" ...
//   kubectl cp is not used. Point --from and --to at the mounted directories.
//
//   node --experimental-strip-types scripts/sandbox-workspace-migrate.ts \
//     --principal pr_... --direction docker-to-pvc --from /mnt/docker --to /mnt/pvc
//
// Reverse is --direction pvc-to-docker with the PVC directory as --from.
// --check compares and writes nothing.
import { pathToFileURL } from "node:url";

import { copyWorkspace, workspaceManifest } from "../server/sandbox/sandbox-workspace-copy.ts";
import { sandboxKeyForPrincipal, sandboxNames } from "../server/sandbox/user-sandbox-spec.ts";

const DIRECTIONS = ["docker-to-pvc", "pvc-to-docker"] as const;
type Direction = (typeof DIRECTIONS)[number];

export interface MigrateArgs {
  principal: string;
  instance: string;
  direction: Direction;
  from: string;
  to: string;
  check: boolean;
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

export function parseMigrateArgs(argv: string[]): MigrateArgs {
  const principal = flag(argv, "--principal")?.trim() ?? "";
  const direction = flag(argv, "--direction")?.trim() ?? "";
  const from = flag(argv, "--from")?.trim() ?? "";
  const to = flag(argv, "--to")?.trim() ?? "";
  if (!principal) throw new Error("--principal is required");
  if (!DIRECTIONS.includes(direction as Direction)) throw new Error("--direction must be docker-to-pvc or pvc-to-docker");
  if (!from || !to) throw new Error("--from and --to are required (the mounted source and destination)");
  return {
    principal,
    instance: flag(argv, "--instance")?.trim() || "default",
    direction: direction as Direction,
    from,
    to,
    check: argv.includes("--check"),
  };
}

export function workspaceVolumeName(instance: string, principalId: string): string {
  return sandboxNames(sandboxKeyForPrincipal(instance, principalId)).volume;
}

function main(): void {
  const args = parseMigrateArgs(process.argv.slice(2));
  const volume = workspaceVolumeName(args.instance, args.principal);
  process.stdout.write(`volume ${volume}\ndirection ${args.direction}\n`);
  if (args.check) {
    const source = workspaceManifest(args.from);
    const dest = workspaceManifest(args.to);
    const destByPath = new Map(dest.files.map((file) => [file.path, file]));
    const mismatch = source.files.filter((file) => {
      const got = destByPath.get(file.path);
      return !got || got.sha256 !== file.sha256 || got.size !== file.size;
    });
    if (mismatch.length) {
      process.stderr.write(`checksum mismatch: ${mismatch.map((file) => file.path).join(", ")}\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`verified ${source.files.length} file(s); nothing written\n`);
    return;
  }
  const result = copyWorkspace(args.from, args.to);
  process.stdout.write(
    `${result.already ? "already matched" : "copied"} ${result.copied} file(s), ${result.unchanged} unchanged, ${result.extras.length} extra destination file(s) left in place\n`,
  );
  if (result.extras.length) process.stdout.write(`extras ${result.extras.join(", ")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
