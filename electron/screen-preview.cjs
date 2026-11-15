function frameKey(frame) {
  if (!Number.isInteger(frame?.processId) || !Number.isInteger(frame?.routingId)) return null;
  return `${frame.processId}:${frame.routingId}`;
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// The one-shot intent a page declares right before getDisplayMedia, in the
// same click: "preview" (the screen preview and screenshot: video only, never
// audio) or "listen" (#4100, listening to a conversation: the computer's
// sound, which the shell can only give beside a screen video; the page drops
// the video at once). A request must match the kind its intent declared.
function createDisplayMediaGuard({ now = Date.now, ttlMs = 5_000 } = {}) {
  const intents = new Map();

  function prune() {
    const current = now();
    for (const [key, intent] of intents) {
      if (intent.expiresAt < current) intents.delete(key);
    }
  }

  function consumeKind(request, expectedOrigin) {
    const key = frameKey(request?.frame);
    if (!key) return null;
    const intent = intents.get(key);
    intents.delete(key);
    const requestOrigin = originOf(request.securityOrigin);
    const allowedOrigin = originOf(expectedOrigin);
    const trusted =
      intent !== undefined &&
      intent.expiresAt >= now() &&
      request.userGesture === true &&
      request.videoRequested === true &&
      requestOrigin !== null &&
      allowedOrigin !== null &&
      requestOrigin === allowedOrigin;
    if (!trusted) return null;
    // the screen preview never gets audio; listening asks for it
    if (intent.kind === "preview") return request.audioRequested === false ? "preview" : null;
    return request.audioRequested === true ? "listen" : null;
  }

  return Object.freeze({
    begin(frame, kind = "preview") {
      const key = frameKey(frame);
      if (!key || (kind !== "preview" && kind !== "listen")) return false;
      prune();
      intents.set(key, { expiresAt: now() + ttlMs, kind });
      return true;
    },

    /** The kind of a trusted request ("preview" or "listen"), or null. */
    consumeKind,

    /** A trusted screen preview request (video only). */
    consume(request, expectedOrigin) {
      return consumeKind(request, expectedOrigin) === "preview";
    },
  });
}

/** Whether this platform can hear the computer's sound (#4100). Linux
 * cannot: the shell does not arm a listen intent there, so the page never
 * asks for a capture that would only be refused (and read as a denied
 * permission Linux does not have); it listens on the microphone only. */
function listensToComputer(platform) {
  return platform === "win32" || platform === "darwin";
}

/** What the shell answers a trusted listen request (#4100): the computer's
 * sound ("loopback", Windows; tried on macOS, where the system asks for the
 * screen and system audio recording permission) beside the screen video the
 * shell requires. Linux has no loopback: no answer, the page listens on the
 * microphone only. */
function listenResponse(platform, source) {
  if (!source || !listensToComputer(platform)) return {};
  return { video: source, audio: "loopback" };
}

function selectCaptureSource({ sources, host, primaryDisplayId }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  if (host === "wayland") return sources.length === 1 ? sources[0] : null;
  if (host === "x11") {
    const exact = sources.find(
      (source) =>
        source.display_id !== undefined &&
        primaryDisplayId !== undefined &&
        String(source.display_id) === String(primaryDisplayId),
    );
    // Some X11 backends omit or misreport display_id. A single enumerated
    // source is still unambiguous; never guess when multiple sources remain.
    return exact ?? (sources.length === 1 ? sources[0] : null);
  }
  if (host === "darwin") return sources[0];
  return null;
}

// Electron may throw synchronously from the display-media callback when an
// empty response rejects a video request. That rejection is expected after a
// portal cancellation, but allowing it to escape from a Promise catch creates
// an unhandled rejection in the main process. Return the error to the caller so
// successful-response failures can still be logged without destabilizing the
// cancellation path.
function invokeDisplayMediaCallback(callback, response) {
  try {
    callback(response);
    return null;
  } catch (error) {
    return error;
  }
}

module.exports = {
  createDisplayMediaGuard,
  frameKey,
  invokeDisplayMediaCallback,
  listenResponse,
  listensToComputer,
  originOf,
  selectCaptureSource,
};
