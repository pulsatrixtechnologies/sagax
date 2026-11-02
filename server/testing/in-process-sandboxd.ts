// The real provisioner logic (SandboxService over a FakeDocker) behind a
// SandboxdClient, as the Sagax server sees it over HTTP: a refusal arrives as
// a SandboxdRequestError carrying the provisioner's code.
import { SandboxError, type SandboxService } from "../sandboxd-core.ts";
import { SandboxdRequestError, type SandboxdClient } from "../user-sandbox-client.ts";

const wire = <T>(work: () => Promise<T>): Promise<T> => work().catch((error: unknown) => {
  throw error instanceof SandboxError ? new SandboxdRequestError(error.status, error.code, error.message) : error;
});

export function inProcessSandboxdClient(service: SandboxService, maxRunning = 3): SandboxdClient {
  return {
    info: async () => ({ instance: service.config.instance, egress: service.egress, maxRunning, idleMinutes: 15 }),
    status: (key) => wire(() => service.status(key)),
    ensure: (key) => wire(() => service.ensure(key)),
    stop: (key) => wire(() => service.stop(key)),
    pause: (key) => wire(() => service.pause(key)),
    resume: (key) => wire(() => service.resume(key)),
    markUsed: (key) => wire(() => service.markUsed(key)),
    stats: (key) => wire(() => service.stats(key)),
    remove: (key, options) => wire(() => service.remove(key, options)),
    exec: (key, input) => wire(() => service.exec(key, input)),
    desktopStream: (key, options) => wire(() => service.desktopStream(key, options)),
    stdioStream: (key, spec) => wire(() => service.stdioStream(key, spec)),
    ttyStream: (key, size, cwd) => wire(async () => {
      const tty = await service.ttyStream(key, size, cwd);
      return { stream: tty.stream, resize: (cols: number, rows: number) => void tty.resize({ cols, rows }) };
    }),
  };
}
