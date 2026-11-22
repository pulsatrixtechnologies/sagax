// The Docker CLI is the only local piece of the VPS backend. Every command is
// `docker -H ssh://<alias>` and the daemon stays on the server, so a missing
// client is the one VPS problem a person fixes in a terminal.
const DOCKER_CLI_INSTALL: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: "brew install docker",
  win32: "winget install -e --id Docker.DockerCLI",
  linux: "sudo apt install docker-ce-cli",
};

export function dockerCliInstallCommand(platform: NodeJS.Platform = process.platform): string | null {
  return DOCKER_CLI_INSTALL[platform] ?? null;
}

/** spawn reports ENOENT for an absent docker. Every other failure keeps its own message. */
export function dockerCliMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b/.test(message) && /docker/i.test(message);
}

export function dockerCliMissingProblem(platform: NodeJS.Platform = process.platform): string {
  const command = dockerCliInstallCommand(platform);
  return command
    ? `The Docker CLI is not on PATH. Install the client only: ${command}`
    : "The Docker CLI is not on PATH. Install the Docker client, then retry.";
}

/** Lifecycle errors surface the spawn failure, so a missing client carries the hint too. */
export function dockerCliStartMessage(error: Error, platform: NodeJS.Platform = process.platform): string {
  return `Docker-over-SSH could not start: ${error.message}${dockerCliMissing(error) ? `. ${dockerCliMissingProblem(platform)}` : ""}`;
}
