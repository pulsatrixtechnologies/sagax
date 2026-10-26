import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { appPermissionAllowed, appPermissionHandlers, connectorSetupUrl, externalMailUrl, externalOpenUrl, externalWebUrl, remoteClipboardWriteAllowed } from "./app-permissions.mjs";

const LOCAL_ORIGIN = "http://127.0.0.1:5199";
const LOCAL_PAGE = "http://127.0.0.1:5199/chat?botId=bot-1";

test("grants notifications, clipboard, and fullscreen to the local renderer page", () => {
  for (const permission of ["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), true, permission);
  }
});

test("accepts a bare origin or a full URL on either side", () => {
  assert.equal(appPermissionAllowed("notifications", LOCAL_ORIGIN, LOCAL_ORIGIN), true);
  assert.equal(appPermissionAllowed("notifications", `${LOCAL_ORIGIN}/settings#voice`, `${LOCAL_ORIGIN}/`), true);
  assert.equal(appPermissionAllowed("fullscreen", "http://127.0.0.1:8799/chat", "http://127.0.0.1:8799"), true);
});

test("allows media for audio (microphone) and guarded display-capture, denies video (camera)", () => {
  // Audio only: allowed
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio"] }), true);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "audio" }), true);

  // Guarded display-capture path: Electron 43 routes getDisplayMedia through permission="media"
  // with an empty mediaTypes array before dispatching to setDisplayMediaRequestHandler
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: [] }), true);

  // Video / camera: strictly denied
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaTypes: ["audio", "video"] }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "video" }), false);

  // Unknown or omitted details: fail closed
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, { mediaType: "unknown" }), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, {}), false);
  assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("refuses permissions to any other origin", () => {
  assert.equal(appPermissionAllowed("notifications", "https://other.example/chat", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("clipboard-read", "http://127.0.0.1:5200/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("media", "https://127.0.0.1:5199/", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("fullscreen", "http://localhost:5199/", LOCAL_ORIGIN), false);
});

test("keeps every privileged capability off even for the local renderer page", () => {
  const privileged = [
    "geolocation", "camera", "usb", "hid", "serial", "midi", "midiSysex",
    "display-capture", "fileSystem", "openExternal", "idle-detection", "speaker-selection",
    "window-management", "storage-access", "top-level-storage-access", "pointerLock",
    "keyboardLock", "mediaKeySystem", "unknown",
  ];
  for (const permission of privileged) {
    assert.equal(appPermissionAllowed(permission, LOCAL_PAGE, LOCAL_ORIGIN), false, permission);
  }
  assert.equal(appPermissionAllowed(undefined, LOCAL_PAGE, LOCAL_ORIGIN), false);
});

test("rejects mixed, unknown, and conflicting media details", () => {
  for (const details of [
    { mediaTypes: ["audio", "unknown"] }, { mediaTypes: ["unknown"] },
    { mediaType: "audio", mediaTypes: ["video"] },
    { mediaType: "unknown", mediaTypes: [] }, { mediaTypes: "audio" }, null,
  ]) assert.equal(appPermissionAllowed("media", LOCAL_PAGE, LOCAL_ORIGIN, details), false);
});

test("web links reject embedded credentials and non-web schemes", () => {
  assert.equal(externalWebUrl("https://example.com/help?q=hello#more"), "https://example.com/help?q=hello#more");
  assert.equal(externalWebUrl("http://127.0.0.1:8799"), "http://127.0.0.1:8799/");
  for (const url of ["https://user:pass@example.com", "http://user@example.com", "https://:pass@example.com"])
    assert.throws(() => externalWebUrl(url), /credentials/);
  for (const url of ["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "mailto:test@example.com"])
    assert.throws(() => externalWebUrl(url), /Only web/);
  for (const url of [null, 123, "not a url"])
    assert.throws(() => externalWebUrl(url), /web address/);
});

test("both external-link entry points use the policy and IPC retains the desktop-UI gate", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  // this app's own UI: the local page, or its bundle on an organization server
  assert.match(main, /ipcMain\.handle\("desktop:open-external", desktopUiOnly\("desktop:open-external"/);
  assert.match(main, /shell\.openExternal\(externalWebUrl\(rawUrl\)\)/);
  assert.match(main, /shell\.openExternal\(externalOpenUrl\(url\)\)/);
});

test("a Connect card opens grok.com or claude.ai only, over https, through its own desktop-UI channel", () => {
  assert.equal(connectorSetupUrl("https://grok.com/connectors"), "https://grok.com/connectors");
  assert.equal(connectorSetupUrl("https://claude.ai/customize/connectors"), "https://claude.ai/customize/connectors");
  for (const url of ["http://grok.com/connectors", "https://grok.com.evil.example/", "https://evil.example/connectors", "https://user:pw@claude.ai/", "https://grok.com:8443/", "javascript:alert(1)", "mailto:a@b.c", null, 42, "not a url"])
    assert.throws(() => connectorSetupUrl(url));
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("desktop:open-connector-setup", desktopUiOnly\("desktop:open-connector-setup"/);
  assert.match(main, /shell\.openExternal\(connectorSetupUrl\(rawUrl\)\)/);
  const preload = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /openConnectorSetup: \(url\) => ipcRenderer\.invoke\("desktop:open-connector-setup", url\)/);
  assert.match(preload, /BUNDLED_EXTRA = new Set\(\[[^\]]*"openConnectorSetup"/);
});

test("window.open also hands a bounded mailto: draft to the mail client, nothing else", () => {
  const draft = "mailto:ana@example.com?subject=Hello%20there&body=Line%201%0D%0ALine%202";
  assert.equal(externalMailUrl(draft), draft);
  assert.equal(externalOpenUrl(draft), draft);
  assert.equal(externalOpenUrl("https://example.com/"), "https://example.com/");
  for (const url of ["mailto:a@b.c\nX-Header: evil", `mailto:a@b.c?body=${"x".repeat(40_000)}`, "javascript:alert(1)", "file:///etc/passwd"])
    assert.throws(() => externalOpenUrl(url));
  // the IPC entry point stays web-only
  assert.throws(() => externalWebUrl(draft), /Only web/);
});

test("fails closed on unparsable or opaque origins", () => {
  assert.equal(appPermissionAllowed("notifications", "not a url", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", "", LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", undefined, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", null, LOCAL_ORIGIN), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, "not a url"), false);
  assert.equal(appPermissionAllowed("notifications", LOCAL_PAGE, undefined), false);
  // Opaque origins all serialise as "null"; two of them must never match.
  assert.equal(appPermissionAllowed("notifications", "data:text/html,x", "about:blank"), false);
  assert.equal(appPermissionAllowed("notifications", "javascript:alert(1)", LOCAL_ORIGIN), false);
});

test("voice mode in server mode: the organization server's bundled UI may open the microphone only", () => {
  const ORG = "https://sagax.example.test";
  const extra = { microphoneOrigins: [ORG, null] };
  assert.equal(appPermissionAllowed("media", `${ORG}/chat`, LOCAL_ORIGIN, { mediaTypes: ["audio"] }, extra), true);
  assert.equal(appPermissionAllowed("media", `${ORG}/chat`, LOCAL_ORIGIN, { mediaType: "audio" }, extra), true);
  // never the camera, the screen, or anything but media
  assert.equal(appPermissionAllowed("media", `${ORG}/chat`, LOCAL_ORIGIN, { mediaTypes: ["video"] }, extra), false);
  assert.equal(appPermissionAllowed("media", `${ORG}/chat`, LOCAL_ORIGIN, { mediaTypes: ["audio", "video"] }, extra), false);
  assert.equal(appPermissionAllowed("media", `${ORG}/chat`, LOCAL_ORIGIN, { mediaTypes: [] }, extra), false);
  for (const permission of ["notifications", "clipboard-read", "geolocation", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, `${ORG}/chat`, LOCAL_ORIGIN, {}, extra), false, permission);
  }
  // another origin, or no server mode: refused
  assert.equal(appPermissionAllowed("media", "https://evil.example.test/", LOCAL_ORIGIN, { mediaTypes: ["audio"] }, extra), false);
  assert.equal(appPermissionAllowed("media", `${ORG}/chat`, LOCAL_ORIGIN, { mediaTypes: ["audio"] }), false);
  assert.equal(appPermissionAllowed("media", `${ORG}/chat`, LOCAL_ORIGIN, { mediaTypes: ["audio"] }, { microphoneOrigins: [null] }), false);
});


// ── The session's handlers: this computer's page, the organization server's
// bundled UI, and the active paired server ──
const ORG_UI = "https://sagax.example.test";
function handlersFixture({ active = null, microphone = [] } = {}) {
  const state = { active, main: { getURL: () => LOCAL_PAGE } };
  const handlers = appPermissionHandlers({
    rendererOrigin: () => LOCAL_ORIGIN,
    mainContents: () => state.main,
    microphoneOrigins: () => microphone,
    activeRemoteOrigin: () => state.active,
  });
  const ask = (permission, details, contents = state.main) => {
    let granted;
    handlers.request(contents, permission, (value) => { granted = value; }, details);
    return granted;
  };
  const check = (permission, requestingOrigin, details, contents = state.main) => handlers.check(contents, permission, requestingOrigin, details);
  return { state, handlers, ask, check };
}

test("this computer's own page keeps its permissions through the same handlers", () => {
  const { ask, check } = handlersFixture();
  const local = { getURL: () => LOCAL_PAGE };
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["audio"] }, local), true);
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: [] }, local), true, "guarded display capture");
  assert.equal(ask("media", { requestingUrl: LOCAL_PAGE, isMainFrame: true, mediaTypes: ["video"] }, local), false);
  assert.equal(ask("notifications", { requestingUrl: LOCAL_PAGE, isMainFrame: true }, local), true);
  // No requesting URL: the window's own address decides, as before.
  assert.equal(ask("notifications", {}, local), true);
  assert.equal(check("clipboard-read", "", { isMainFrame: true }, local), true);
  assert.equal(check("clipboard-read", "https://other.example", { isMainFrame: true }, local), false);
});

test("the handlers give the organization server's bundled UI the microphone only", () => {
  const { ask, check } = handlersFixture({ microphone: [ORG_UI] });
  const page = { getURL: () => `${ORG_UI}/chat` };
  assert.equal(ask("media", { requestingUrl: `${ORG_UI}/chat`, isMainFrame: true, mediaTypes: ["audio"] }, page), true);
  assert.equal(ask("media", { requestingUrl: `${ORG_UI}/chat`, isMainFrame: true, mediaTypes: ["video"] }, page), false);
  assert.equal(ask("media", { requestingUrl: `${ORG_UI}/chat`, isMainFrame: true, mediaTypes: [] }, page), false);
  for (const permission of ["notifications", "clipboard-read", "fullscreen", "geolocation"]) {
    assert.equal(check(permission, ORG_UI, { isMainFrame: true }, page), false, permission);
  }
});

test("the app installs these handlers once, and perm:status asks them", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(main, /setPermissionRequestHandler\(appPermissions\.request\)/);
  assert.match(main, /setPermissionCheckHandler\(appPermissions\.check\)/);
  // perm:status's pageMic asks these very handlers: one module-level set,
  // never a second const that would leave perm:status answering "refused".
  assert.match(main, /ipcMain\.handle\("perm:status", \(event\) => \(\{[^}]*pageMic: appPermissions\?\.pageMicrophone\(event\) \?\? "refused",/s);
  assert.match(main, /^let appPermissions = null;$/m);
  assert.match(main, /^  appPermissions = appPermissionHandlers\(\{$/m);
  assert.doesNotMatch(main, /(const|let|var) appPermissions = appPermissionHandlers/);
  // No hosted Cloud: nothing in main grants a Cloud page anything.
  assert.doesNotMatch(main, /cloudHomeOrigin/);
});

// ── What a page is told when its microphone is refused ──
// perm:status answers `pageMic` for the asking page, so a blocked Live call
// can say who blocked it: this app (then a web browser can make the call) or
// the computer (then its privacy settings can). The answer is the request
// handler's own, never a second copy of the rule.
const ipcFrom = (contents, frameUrl, { mainFrame = true } = {}) => {
  const frame = { url: frameUrl };
  if (mainFrame) contents.mainFrame = frame;
  else contents.mainFrame ??= { url: contents.getURL() };
  return { sender: contents, senderFrame: frame };
};

test("a page asking about its microphone hears whether this app lets it use it", () => {
  const { state, handlers } = handlersFixture({ microphone: [ORG_UI] });
  const local = { getURL: () => LOCAL_PAGE };
  assert.equal(handlers.pageMicrophone(ipcFrom(local, LOCAL_PAGE)), "allowed", "this computer's own page");
  const org = { getURL: () => `${ORG_UI}/chat` };
  assert.equal(handlers.pageMicrophone(ipcFrom(org, `${ORG_UI}/chat`)), "allowed", "the organization server's bundled UI");
  state.main = { getURL: () => "https://my-vps.example.com/chat" };
  assert.equal(handlers.pageMicrophone(ipcFrom(state.main, "https://my-vps.example.com/chat")), "refused", "another server");
  assert.equal(handlers.pageMicrophone({ sender: state.main, senderFrame: null }), "refused", "a frame that is gone");
  assert.equal(handlers.pageMicrophone(undefined), "refused", "no sender");
});

test("the page's answer is the request handler's answer for its microphone", async () => {
  const { state, handlers } = handlersFixture({ microphone: [ORG_UI] });
  const local = { getURL: () => LOCAL_PAGE };
  const other = { getURL: () => "https://my-vps.example.com/" };
  for (const contents of [state.main, local, other]) {
    for (const url of [`${ORG_UI}/chat`, LOCAL_PAGE, "https://my-vps.example.com/", "http://evil.example.test/"]) {
      for (const mainFrame of [true, false]) {
        const granted = await new Promise((resolve) => {
          handlers.request(contents, "media", resolve, { requestingUrl: url, isMainFrame: mainFrame, mediaTypes: ["audio"] });
        });
        const label = JSON.stringify({ page: contents.getURL(), url, mainFrame });
        assert.equal(handlers.pageMicrophone(ipcFrom(contents, url, { mainFrame })), granted ? "allowed" : "refused", label);
      }
    }
  }
});

const REMOTE = "https://host.example-tailnet.ts.net:9444";

test("a remote server may write clipboard text only as the active origin's main frame", () => {
  const write = "clipboard-sanitized-write";
  assert.equal(remoteClipboardWriteAllowed(write, `${REMOTE}/chat?x=1`, REMOTE, { isMainFrame: true }), true);
  assert.equal(remoteClipboardWriteAllowed(write, REMOTE, `${REMOTE}/`, { isMainFrame: true }), true);
  // Read and everything else stay denied for the same trusted origin.
  for (const permission of ["clipboard-read", "notifications", "fullscreen", "media", "geolocation", "camera", "openExternal", "unknown", undefined]) {
    assert.equal(remoteClipboardWriteAllowed(permission, REMOTE, REMOTE, { isMainFrame: true }), false, String(permission));
  }
  // Frame requirement: a child frame, or no frame information, never counts.
  for (const details of [{ isMainFrame: false }, {}, undefined, null, { isMainFrame: "true" }]) {
    assert.equal(remoteClipboardWriteAllowed(write, REMOTE, REMOTE, details), false);
  }
  // Exact origin only.
  for (const requesting of [
    "https://host.example-tailnet.ts.net:9445/", "https://host.example-tailnet.ts.net/", "http://host.example-tailnet.ts.net:9444/",
    "https://other.example-tailnet.ts.net:9444/", "https://host.example-tailnet.ts.net.evil.test:9444/", "https://evil.test/#https://host.example-tailnet.ts.net:9444",
    "about:blank", "data:text/html,x", "javascript:alert(1)", "not a url", "", null, undefined,
  ]) assert.equal(remoteClipboardWriteAllowed(write, requesting, REMOTE, { isMainFrame: true }), false, String(requesting));
  // No active remote server (Local, or a damaged value): nothing to match.
  for (const active of [undefined, null, "", "not a url", "about:blank", "data:text/html,x"]) {
    assert.equal(remoteClipboardWriteAllowed(write, REMOTE, active, { isMainFrame: true }), false, String(active));
    assert.equal(remoteClipboardWriteAllowed(write, "about:blank", active, { isMainFrame: true }), false);
  }
});

test("the active remote server open in this window may write the clipboard through the handlers, and nothing else", () => {
  const write = "clipboard-sanitized-write";
  const { state, ask, check } = handlersFixture({ active: REMOTE });
  state.main = { getURL: () => `${REMOTE}/chat` };
  const onRemote = (fields = {}) => ({ requestingUrl: `${REMOTE}/chat`, isMainFrame: true, ...fields });
  assert.equal(ask(write, onRemote()), true);
  assert.equal(check(write, REMOTE, { isMainFrame: true }), true);
  assert.equal(ask("clipboard-read", onRemote()), false);
  assert.equal(ask("media", onRemote({ mediaTypes: ["audio"] })), false);
  assert.equal(ask(write, onRemote({ isMainFrame: false })), false, "a subframe");
  assert.equal(ask(write, onRemote(), { getURL: () => `${REMOTE}/` }), false, "another window");
  // Switching back to this computer withdraws it at once.
  state.active = null;
  assert.equal(ask(write, onRemote()), false);
});

test("the base policy itself still grants a remote origin nothing", () => {
  for (const permission of ["clipboard-sanitized-write", "clipboard-read", "notifications", "fullscreen"]) {
    assert.equal(appPermissionAllowed(permission, REMOTE, LOCAL_ORIGIN, { isMainFrame: true }), false, permission);
  }
});
