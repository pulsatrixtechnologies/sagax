// Entry point for the `openmausbot` command (see cli.ts).
import "../electron/legacy-env-boot.mjs";
import { main } from "./cli.ts";
import { exitAfterFlush } from "./process/exit.ts";

main().then(exitAfterFlush, (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exitAfterFlush(1);
});
