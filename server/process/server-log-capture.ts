// The server log tail of the console's Logs page (server/process/server-log-ring.ts),
// capturing from the first import on: index.ts imports this before anything
// that logs.
import { captureConsole, ServerLogRing } from "./server-log-ring.ts";

export const serverLog = new ServerLogRing();
captureConsole(serverLog);
