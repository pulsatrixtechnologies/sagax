// `handOffInstall` swaps the terminal step: instead of quitting and letting
// electron-updater run the installer, the downloaded file is handed to the
// user. Ubuntu system packages use it — see electron/updater.mjs for why a
// chat app must not run dpkg itself. Everything before the install is shared.
// It receives the staged paths and resolves with an optional state patch
// describing what is left to do, which the card renders.
import { updateErrorMessage, updateErrorNeedsPerson } from "./update-errors.mjs";
import { compareReleaseVersions } from "./update-feed.mjs";

/** Idle deadline for the native macOS staging pass. Every download-progress
 * resets it, so a transfer that is still moving bytes is never a hang.
 * Large staging needs more than the old five minutes. */
export const NATIVE_PREPARE_TIMEOUT_MS = 20 * 60 * 1000;

// The feed's releaseNotes: a string (the latest GitHub release body) or one
// { version, note } per skipped version when fullChangelog is on. Anything
// else is dropped so the renderer only ever sees text.
export function releaseNotesFrom(info) {
  const raw = info?.releaseNotes;
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return undefined;
  const notes = [];
  for (const item of raw) {
    if (!item || typeof item.version !== "string" || !item.version.trim()) continue;
    notes.push({
      version: item.version.trim(),
      note: typeof item.note === "string" ? item.note : "",
    });
  }
  return notes;
}

/** electron-updater's release notes as one string for the renderer: the
 * GitHub provider gives the release body (HTML), a multi-release feed an
 * array of { version, note }. Capped, because it rides every state broadcast. */
export function releaseNotesText(notes) {
  const text = typeof notes === "string"
    ? notes
    : Array.isArray(notes)
      ? notes.map((entry) => (typeof entry?.note === "string" ? entry.note : "")).filter(Boolean).join("\n")
      : "";
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 8000) : undefined;
}

// GitHub's releases.atom gives each body as HTML. The release file is
// markdown, so HTML here means the feed had nothing better.
const HTML_NOTE = /<\/?(?:p|h[1-6]|ul|ol|li|strong|em|a|code|pre|br|div|blockquote)\b[^>]*>/i;

function noteFor(notes, version) {
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) return notes.find((entry) => entry.version === version)?.note ?? "";
  return "";
}

/** True when the feed brought no readable (markdown) notes for `version`. */
export function needsReleaseNotes(notes, version) {
  const note = noteFor(notes, version).trim();
  return !note || HTML_NOTE.test(note);
}

/** The feed's notes with `body` as the note of `version`. */
export function withReleaseNote(notes, version, body) {
  if (!Array.isArray(notes)) return body;
  return [{ version, note: body }, ...notes.filter((entry) => entry.version !== version)];
}

/** The update's notes plus the notes of every version it skips, one entry
 * per version, newest first. The feed (latest*.yml) carries the newest
 * release's notes alone, so one update over 0.8.7 and 0.8.8 must still show
 * both. Notes the feed already has for a version are kept. */
export function withSkippedNotes(notes, version, skipped) {
  const extra = Array.isArray(skipped) ? skipped.filter((entry) => entry && typeof entry.version === "string" && typeof entry.note === "string" && entry.note.trim()) : [];
  if (extra.length === 0) return notes;
  const base = Array.isArray(notes)
    ? notes
    : typeof notes === "string" && notes.trim() ? [{ version, note: notes }] : [];
  const known = new Set(base.map((entry) => entry.version));
  const merged = [...base, ...extra.filter((entry) => !known.has(entry.version))];
  return merged.sort((a, b) => compareReleaseVersions(b.version, a.version));
}

/**
 * `fetchReleaseNotes(version)` resolves the release's markdown body (or null)
 * when the feed brought none: the notes must show before every update. It is
 * asked once per version; its answer arrives as a later state patch.
 */
export function createUpdaterCoordinator(
  updater,
  setState,
  {
    handOffInstall = null,
    nativeStaging = false,
    fetchReleaseNotes = null,
    // `fetchSkippedNotes(fromVersion, toVersion)` resolves [{ version, note }]
    // for every release between the running app and the update, so the
    // notes cover all of them, not the newest alone.
    fetchSkippedNotes = null,
    // The running app's version (electron-updater's currentVersion).
    currentVersion = () => updater.currentVersion?.version ?? null,
    // Right before installing, the feed is read again so a release published
    // after the download installs instead (one update, never two in a row).
    // A feed that does not answer within this delay installs what is ready.
    refreshTimeoutMs = 20_000,
    // Windows: false, so the NSIS installer shows its progress window and
    // relaunches the app (see electron/updater.mjs).
    silentInstall = true,
    // Asks the person before an install nobody confirmed in the page (an
    // older page's button, a stray call). Resolves true to go on. Without
    // it such a call does nothing: nothing installs unconfirmed.
    confirmInstall = null,
    // How long the native macOS staging pass (Squirrel.Mac unpacking the ZIP
    // after the transfer) may run before we declare it hung. The 0.7.x assets
    // are hundreds of MB, and staging is disk-bound, so a slow or full disk
    // needs far more than the old five minutes. The watchdog is reset by every
    // download-progress, so this is an idle deadline, never a wall clock on a
    // transfer that is still moving bytes.
    prepareTimeoutMs = NATIVE_PREPARE_TIMEOUT_MS,
  } = {},
) {
  // The update the state shows, and the body the release API gave for it.
  let notesVersion = null;
  let feedNotes = undefined;
  let fetched = null;
  let notesRequest = null;
  // The notes of the versions the update skips, once read.
  let skipped = null;
  let skippedRequest = null;

  function composedNotes(version, base) {
    let notes = base;
    if (fetched?.version === version && needsReleaseNotes(notes, version)) notes = withReleaseNote(notes, version, fetched.body);
    if (skipped?.version === version) notes = withSkippedNotes(notes, version, skipped.entries);
    return notes;
  }

  function publishNotes(version) {
    if (recoveryRequired || notesVersion !== version) return;
    const notes = composedNotes(version, feedNotes);
    if (notes === undefined) return;
    setState({ notes, releaseNotes: releaseNotesText(notes) });
  }

  function requestSkipped(version) {
    const from = currentVersion?.();
    if (typeof from !== "string" || !from || skippedRequest === version) return;
    skippedRequest = version;
    Promise.resolve()
      .then(() => fetchSkippedNotes(from, version))
      .then((entries) => {
        skipped = { version, entries: Array.isArray(entries) ? entries : [] };
        if (skipped.entries.length > 0) publishNotes(version);
      })
      .catch(() => {
        // Notes never fail an update; the next event for it asks again.
      })
      .finally(() => {
        if (skippedRequest === version) skippedRequest = null;
      });
  }

  function requestNotes(version) {
    if (notesRequest === version) return;
    notesRequest = version;
    Promise.resolve()
      .then(() => fetchReleaseNotes(version))
      .then((body) => {
        if (typeof body !== "string" || !body.trim()) return;
        fetched = { version, body };
        if (recoveryRequired || notesVersion !== version || !needsReleaseNotes(feedNotes, version)) return;
        publishNotes(version);
      })
      .catch(() => {
        // Notes never fail an update; the next event for it asks again.
      })
      .finally(() => {
        if (notesRequest === version) notesRequest = null;
      });
  }

  function notesOf(info) {
    const notes = releaseNotesFrom(info);
    const version = typeof info?.version === "string" ? info.version : null;
    if (!version) return notes;
    notesVersion = version;
    feedNotes = notes;
    if (fetchReleaseNotes && needsReleaseNotes(notes, version) && fetched?.version !== version) requestNotes(version);
    if (fetchSkippedNotes && skipped?.version !== version) requestSkipped(version);
    return composedNotes(version, notes);
  }

  function withNotes(patch, info) {
    const notes = notesOf(info);
    if (notes === undefined) return patch;
    return "releaseNotes" in patch ? { ...patch, notes, releaseNotes: releaseNotesText(notes) } : { ...patch, notes };
  }

  let checkOperation = null;
  // Set from downloadUpdate's resolution: the paths electron-updater staged.
  // Only the hand-off needs them; quitAndInstall reads its own copy.
  let downloadedFiles = null;
  let downloadOperation = null;
  let installOperation = null;
  let nativeStagingStarted = false;
  let nativeReady = false;
  // Squirrel has no cancellation or attempt ID. After a staging failure a
  // second attempt could consume the first attempt's late ready event.
  let recoveryRequired = false;
  // A staged update, install hand-off, or failed user action remains useful
  // until the user acts again. Hourly checks must not replace its controls.
  let actionOwnsState = false;
  // The update downloaded and ready to install ({ version, info }), or null.
  // Checks keep reading the feed while it waits: a newer release replaces it,
  // so the restart always installs the latest one.
  let ready = null;
  // The feed read right before an install (installConfirmed), or null.
  let refreshing = null;
  // The person clicked "Restart to install" and the refresh found a newer
  // release: it installs as soon as it is downloaded, without a second click.
  let installAfterDownload = false;
  const routedErrors = new WeakSet();

  const newerThanReady = (version) =>
    Boolean(ready && typeof version === "string" && compareReleaseVersions(version, ready.version) > 0);

  function markReady(info) {
    const version = typeof info?.version === "string" ? info.version : null;
    ready = version ? { version, info } : null;
  }

  const routeError = (manual, error) => {
    if (recoveryRequired) return;
    // A background check failed while an update waits to install: the ready
    // update stays as it is, and the next check tries again.
    if (ready && !manual && !downloadOperation && !installOperation) {
      if (error instanceof Error) routedErrors.add(error);
      if (checkOperation) checkOperation.failed = true;
      return;
    }
    ready = null;
    installAfterDownload = false;
    // Nobody asked, and it may pass by itself (offline, a server hiccup): stay
    // quiet and let the next check try again. A failure only the person can
    // fix is shown, and waits for them instead of downloading every hour.
    const shown = manual || updateErrorNeedsPerson(error);
    actionOwnsState = shown;
    if (error instanceof Error) routedErrors.add(error);
    if (downloadOperation) {
      downloadOperation.failed = true;
      clearTimeout(downloadOperation.timer);
    }
    if (checkOperation) checkOperation.failed = true;
    if (installOperation) {
      installOperation.failed = true;
      clearTimeout(installOperation.timer);
      installOperation = null;
    }
    if (nativeStagingStarted) {
      recoveryRequired = true;
      nativeReady = false;
      setState({
        status: "error",
        retryable: false,
        message: `${updateErrorMessage(error)} Quit and reopen Sagax before trying the update again.`,
      });
      return;
    }
    if (!shown) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "error", message: updateErrorMessage(error) });
  };

  function handleRejectedOperation(manual, error) {
    if (error instanceof Error && routedErrors.has(error)) return;
    routeError(manual, error);
  }

  // Squirrel.Mac native staging is event-only: it emits no progress and
  // resolves downloadUpdate solely on the native ready event. If it never
  // readies we would sit in "preparing" forever, so an idle watchdog fails it
  // into a restart-required state. Every download-progress re-arms it, so a
  // transfer that is still moving bytes is never mistaken for a hang.
  function armPrepareWatchdog(operation) {
    if (!operation) return;
    clearTimeout(operation.timer);
    operation.timer = setTimeout(() => {
      if (downloadOperation !== operation || operation.failed) return;
      updater.logger?.warn?.(
        `Native update preparation went quiet past the ${Math.round(prepareTimeoutMs / 60000)}-minute deadline; a restart is required before retrying.`,
      );
      routeError(true, new Error("Preparing the update took too long."));
    }, prepareTimeoutMs);
    operation.timer.unref?.();
  }

  function checkOwnsState() {
    return !recoveryRequired && !refreshing && !actionOwnsState && !installOperation && !downloadOperation && !checkOperation?.supersededByDownload;
  }

  function startDownload(manual, info) {
    download(manual, withNotes({
      version: info?.version,
      releaseNotes: releaseNotesText(info?.releaseNotes),
      percent: undefined,
      message: undefined,
    }, info));
  }

  updater.on("checking-for-update", () => {
    if (checkOwnsState()) setState({ status: "checking" });
  });
  // Updates download by themselves; only the restart waits for the person.
  // This is the one place a download starts. Its failure is shown when the
  // person asked for this check, or when only they can fix it (routeError).
  updater.on("update-available", (info) => {
    // The feed read before an install: its outcome is decided there.
    if (refreshing) {
      refreshing.found = info;
      return;
    }
    if (recoveryRequired || installOperation || downloadOperation) return;
    if (ready && (actionOwnsState || checkOperation?.manual)) {
      // An update is ready. A newer release replaces it now, so the restart
      // (or the quit that installs it) takes the latest in one update.
      if (newerThanReady(info?.version)) {
        actionOwnsState = false;
        startDownload(Boolean(checkOperation?.manual), info);
        return;
      }
      // The same release: keep it ready, nothing to download again.
      actionOwnsState = true;
      setState(withNotes({ status: "downloaded", version: ready.version, message: undefined }, ready.info));
      return;
    }
    if (checkOwnsState()) startDownload(Boolean(checkOperation?.manual), info);
  });
  updater.on("update-not-available", () => {
    if (refreshing) return;
    if (ready && !installOperation && !downloadOperation && !recoveryRequired) {
      actionOwnsState = true;
      if (checkOperation?.manual) setState(withNotes({ status: "downloaded", version: ready.version, message: undefined }, ready.info));
      return;
    }
    if (checkOwnsState()) setState({ status: "idle" });
  });
  // downloadUpdate/checkForUpdates reject after most updater errors, but the
  // macOS native staging pass used by quitAndInstall is event-only. Without
  // this listener a Squirrel.Mac failure leaves the renderer on "Restarting"
  // forever because quitAndInstall itself returns void.
  updater.on("error", (error) => {
    // Shared error events do not identify their operation. If a download
    // overtook a check, let their individual promises route failures instead.
    if (checkOperation?.supersededByDownload && !installOperation) return;
    // The feed read before an install failed: what is ready installs.
    if (refreshing && !installOperation && !downloadOperation) return;
    const manual = Boolean(installOperation || downloadOperation?.manual || checkOperation?.manual || nativeStagingStarted);
    routeError(manual, error);
  });
  updater.on("download-progress", (progress) => {
    if (recoveryRequired || installOperation) return;
    // While the native updater prepares, bytes may still be arriving. Push the
    // preparation deadline back on each one so a large or slow transfer never
    // trips the watchdog; the "preparing" state stays as it is.
    if (nativeStagingStarted) {
      if (downloadOperation && !downloadOperation.failed) armPrepareWatchdog(downloadOperation);
      return;
    }
    setState({ status: "downloading", percent: Math.round(progress?.percent ?? 0) });
  });
  updater.on("update-downloaded", (info) => {
    if (recoveryRequired || installOperation) return;
    // On macOS electron-updater emits this before Squirrel.Mac has finished
    // staging the ZIP. Our vendor patch resolves downloadUpdate only on the
    // native ready event, not merely when the local ZIP transfer finishes.
    if (downloadOperation) {
      downloadOperation.downloadedInfo = info;
      if (nativeStaging && !nativeStagingStarted) {
        nativeStagingStarted = true;
        setState(withNotes({ status: "preparing", version: info?.version, message: undefined }, info));
        armPrepareWatchdog(downloadOperation);
      }
      return;
    }
    // No native attempt may become actionable from an uncorrelated late event.
    if (nativeStaging) return;
    actionOwnsState = true;
    markReady(info);
    setState(withNotes({ status: "downloaded", version: info?.version }, info));
  });

  function check(manual = false) {
    // Asking while an update downloads makes its outcome the person's to see.
    if (manual && downloadOperation) downloadOperation.manual = true;
    // An update ready to install does not stop the hourly check: it looks for
    // a newer release to take its place (update-available).
    if (recoveryRequired || refreshing || installOperation || (nativeStaging && (downloadOperation || (nativeStagingStarted && !ready))) || (!manual && actionOwnsState && !ready)) return Promise.resolve();
    if (checkOperation) {
      // A manual caller upgrades the shared operation; a timer never downgrades it.
      if (manual) checkOperation.manual = true;
      return checkOperation.promise;
    }

    if (manual) actionOwnsState = false;
    // routeError marks the operation failed when its error event is routed; its
    // own rejection, whatever value it carries, is then the same failure.
    const operation = { manual, supersededByDownload: Boolean(downloadOperation), failed: false, promise: null };
    checkOperation = operation;
    try {
      operation.promise = Promise.resolve(updater.checkForUpdates())
        .catch((error) => {
          if (!operation.failed && !operation.supersededByDownload) handleRejectedOperation(operation.manual, error);
        })
        .finally(() => {
          if (checkOperation === operation) checkOperation = null;
        });
    } catch (error) {
      if (!operation.failed && !operation.supersededByDownload) handleRejectedOperation(operation.manual, error);
      checkOperation = null;
      operation.promise = Promise.resolve();
    }
    return operation.promise;
  }

  // Only an update a check found starts here (checkOwnsState: nothing else
  // downloads, installs or awaits recovery). `manual`: the person asked
  // (their check), so a failure is theirs to see. `starting`: what the check
  // found, shown from the first "downloading".
  function download(manual, starting) {
    if (recoveryRequired || installOperation || (nativeStagingStarted && !ready)) return;
    if (checkOperation) checkOperation.supersededByDownload = true;
    // A new download replaces what was ready (macOS stages it again, from
    // "preparing", once its transfer is done).
    ready = null;
    nativeReady = false;
    nativeStagingStarted = false;

    const operation = { downloadedInfo: null, failed: false, manual, timer: null };
    downloadOperation = operation;
    // Own the state before the request goes out: the first "download-progress"
    // can be seconds away (connection setup, redirects). No percent yet — the
    // UI reads a missing percent as "starting".
    setState({ status: "downloading", ...starting });
    try {
      void Promise.resolve(updater.downloadUpdate())
        .then((result) => {
          if (!operation.failed) {
            downloadedFiles = Array.isArray(result) ? result.filter((file) => typeof file === "string") : null;
          }
          if (!operation.failed && operation.downloadedInfo) {
            nativeReady = nativeStaging;
            actionOwnsState = true;
            markReady(operation.downloadedInfo);
            setState(withNotes({ status: "downloaded", version: operation.downloadedInfo?.version }, operation.downloadedInfo));
            if (installAfterDownload) {
              installAfterDownload = false;
              if (downloadOperation === operation) downloadOperation = null;
              finishInstall();
            }
          }
        })
        .catch((error) => handleRejectedOperation(operation.manual, error))
        .finally(() => {
          clearTimeout(operation.timer);
          if (downloadOperation === operation) downloadOperation = null;
        });
    } catch (error) {
      handleRejectedOperation(operation.manual, error);
      downloadOperation = null;
    }
  }

  function installBlocked() {
    return Boolean(recoveryRequired || refreshing || installOperation || downloadOperation || (nativeStaging && !nativeReady));
  }

  /** Installs only on the person's explicit confirmation: `confirmed` from
   * the page's "Restart to install" (the update dialog), otherwise the
   * `confirmInstall` question must say yes first. */
  function install({ confirmed = false } = {}) {
    if (installBlocked()) return;
    if (confirmed === true) return installConfirmed();
    if (!confirmInstall) {
      updater.logger?.warn?.("Install refused: it was not confirmed.");
      return;
    }
    return Promise.resolve()
      .then(() => confirmInstall({ version: notesVersion }))
      .then((yes) => {
        if (yes === true && !installBlocked()) return installConfirmed();
      })
      .catch((error) => updater.logger?.warn?.("Install confirmation failed:", error));
  }

  // The person confirmed. Read the feed once more first: a release published
  // since the download (0.8.7 then 0.8.8 hours apart) downloads and installs
  // in its place, with every skipped version's notes, so the app never comes
  // back up announcing the update it could have taken. A feed that fails or
  // stays silent installs what is ready.
  function installConfirmed() {
    actionOwnsState = true;
    const operation = { found: null, timer: null };
    refreshing = operation;
    setState({ status: "installing", message: undefined });
    let checked;
    try {
      checked = Promise.resolve(updater.checkForUpdates());
    } catch (error) {
      checked = Promise.reject(error);
    }
    const timedOut = new Promise((resolve) => {
      operation.timer = setTimeout(resolve, refreshTimeoutMs);
      operation.timer.unref?.();
    });
    return Promise.race([checked.then(() => undefined, () => undefined), timedOut]).then(() => {
      clearTimeout(operation.timer);
      if (refreshing !== operation) return;
      refreshing = null;
      const found = operation.found;
      if (recoveryRequired || installOperation) return;
      if (newerThanReady(found?.version)) {
        updater.logger?.info?.(`A newer release (${found.version}) was published since ${ready.version} downloaded; installing it instead.`);
        installAfterDownload = true;
        actionOwnsState = false;
        startDownload(true, found);
        return;
      }
      finishInstall();
    });
  }

  function finishInstall() {
    if (recoveryRequired || installOperation || downloadOperation || (nativeStaging && !nativeReady)) return;
    actionOwnsState = true;
    if (handOffInstall) {
      handOff();
      return;
    }
    const operation = { failed: false, timer: null };
    installOperation = operation;
    setState({ status: "installing" });
    try {
      // isForceRunAfter: Sagax opens again once the new version is in.
      updater.quitAndInstall(silentInstall, true);
    } catch (error) {
      routeError(true, error);
      return;
    }
    // quitAndInstall is void and cannot be canceled. A slow handoff must stay
    // busy: exposing Retry here used to arm another native quit callback.
    if (installOperation === operation) {
      operation.timer = setTimeout(() => {
        if (installOperation !== operation) return;
        updater.logger?.warn?.("Update restart handoff exceeded two minutes; keeping installation locked to prevent overlapping retries.");
        setState({ status: "installing", message: "Restart is taking longer than expected. Quit and reopen Sagax to finish the update." });
      }, 2 * 60 * 1000);
      operation.timer.unref?.();
    }
  }

  // The platform owns the install from here: a terminal opens with the
  // command on the clipboard and the user finishes there. No quit — the
  // running app stays usable, and the new version is picked up next launch.
  function handOff() {
    const operation = { failed: false, timer: null };
    installOperation = operation;
    setState({ status: "installing" });
    Promise.resolve()
      .then(() => handOffInstall(downloadedFiles))
      .then((patch) => {
        if (installOperation !== operation) return;
        installOperation = null;
        ready = null;
        setState({ status: "handed-off", ...patch });
      })
      .catch((error) => {
        if (installOperation !== operation) return;
        routeError(true, error);
      });
  }

  return { check, install };
}
