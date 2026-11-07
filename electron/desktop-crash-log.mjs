// The server stream is intentionally asynchronous, but a fatal main-process
// exception may terminate Electron before such a write is flushed. Crash
// metadata gets its own tiny synchronous file. The formatter admits only a
// fixed set of fields, so renderer URLs, page titles, exception messages and
// absolute paths never land on disk or in a public bug report.
/** The synchronous, bounded crash-metadata writer (#file-size-ratchet: moved out of main.mjs). */
export function createDesktopCrashRecorder({ fs, platform, logDir, logFile, maxBytes, formatRecord }) {
  return function recordDesktopCrash(event) {
    let handle = null;
    try {
      const record = formatRecord(event);
      if (!record) return;
      fs.mkdirSync(logDir, { recursive: true });

      const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_APPEND |
        (platform === "win32" ? 0 : fs.constants.O_NOFOLLOW);
      let before = null;
      try {
        before = fs.lstatSync(logFile);
        if (!before.isFile() || before.nlink !== 1) return;
        handle = fs.openSync(logFile, flags);
      } catch (error) {
        if (error?.code !== "ENOENT") return;
        // O_EXCL makes first creation race-safe on Windows, where O_NOFOLLOW is
        // unavailable, as well as on POSIX.
        try {
          handle = fs.openSync(
            logFile,
            flags | fs.constants.O_CREAT | fs.constants.O_EXCL,
            0o600,
          );
        } catch {
          return;
        }
      }

      const stats = fs.fstatSync(handle);
      // A hard-linked or non-regular target is not an app-owned crash log.
      if (!stats.isFile() || stats.nlink !== 1) return;
      if (before && (before.dev !== stats.dev || before.ino !== stats.ino)) return;
      // A renderer crash loop must not grow a persistent log without bound.
      // The diagnostics export reads only a bounded tail, so dropping older
      // crash metadata here preserves the useful part of the record.
      if (stats.size >= maxBytes) fs.ftruncateSync(handle, 0);
      if (platform !== "win32") fs.fchmodSync(handle, 0o600);
      fs.writeFileSync(handle, `[${new Date().toISOString()}] ${record}\n`, "utf8");
    } catch {
      /* crash diagnostics must never change app lifecycle */
    } finally {
      if (handle !== null) {
        try {
          fs.closeSync(handle);
        } catch {}
      }
    }
  }
}
