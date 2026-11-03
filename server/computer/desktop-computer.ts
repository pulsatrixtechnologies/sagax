// This computer's driver connection reaches the server only from the desktop
// app that launched it. Electron hands it to its own utility-process child
// over that child's private parent port, at spawn and again on every driver
// change (electron/local-computer-grant.mjs). Only the app's main process can
// write to that port, and a server started any other way has none, so it
// never learns this computer's connection. No file, environment variable or
// HTTP route supplies it.

export const LOCAL_COMPUTER_MESSAGE = "sagax:local-computer";

type ParentPort = {
  on(event: "message", listener: (event: { data?: unknown }) => void): void;
};

let record: Readonly<Record<string, unknown>> | null = null;
let listening = false;

/** The record the desktop app last handed over, or null: not launched by the
 * app, not handed over yet, or the app said this computer is unavailable in a
 * record of its own (server/local-computer.ts reads which). */
export function desktopComputerRecord(): Readonly<Record<string, unknown>> | null {
  return record;
}

function receive(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const message = raw as Record<string, unknown>;
  if (message.type !== LOCAL_COMPUTER_MESSAGE) return false;
  const connection = message.connection;
  record = connection && typeof connection === "object" && !Array.isArray(connection)
    ? Object.freeze(structuredClone(connection) as Record<string, unknown>)
    : null;
  return true;
}

/** Listen on the desktop parent port, the only way in. Plain Node has no
 * parentPort, so a server not launched by the app never listens. */
export function listenForDesktopComputer(
  // SAFETY: Electron's utility-process runtime is the only environment that
  // supplies parentPort; plain Node intentionally leaves it absent.
  port: ParentPort | undefined = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort,
): boolean {
  if (!port) return false;
  listening = true;
  port.on("message", (event) => {
    try {
      receive(event?.data);
    } catch (error) {
      console.error(`[desktop-computer] rejected connection message: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return true;
}

/** Whether the desktop app launched this server, so it can hand over this
 * computer at all. */
export function launchedByDesktopApp(): boolean {
  return listening;
}
