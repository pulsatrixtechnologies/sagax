// Electron side of scripts/verify/dev/verify-desktop-sign-in.ts: the app's real preload
// on a remote environment's page, the real handoff and loopback listener, and
// main's delivery. The "system browser" is played with fetch (start, the fake
// provider, the callback, the loopback page and its post).
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const signIn = require("../../../electron/oidc-system-sign-in.cjs");

const origin = process.env.VERIFY_ORIGIN;
const oldTarget = process.env.VERIFY_OLD_TARGET === "1";
const log = (line) => console.log(`[sign-in] ${line}`);
const handoff = signIn.createSignInHandoff();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "..", "electron", "preload.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      // a remote page: the preload gives it the remote-safe subset only
      additionalArguments: ["--omb-local-origin=http://127.0.0.1:1"],
    },
  });
  ipcMain.handle("auth-return:take", (event, code) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
    const handed = handoff.redeem(new URL(event.senderFrame.url).origin, code);
    log(`/pair asked to redeem: ${handed ? "confirmed" : "refused"}`);
    return handed;
  });
  ipcMain.handle("pulsatrix-sign-in:state", () => ({ status: "waiting", origin }));
  // main always answers this (electron/main.mjs): this window is a plain
  // remote page, not this app's bundle on an organization server
  ipcMain.on("workspace:bundled-ui", (event) => { event.returnValue = false; });
  win.webContents.session.webRequest.onCompleted({ urls: [`${origin}/api/auth/pair`] }, (d) => {
    if (d.method === "POST") log(`redeem POST answered ${d.statusCode}`);
  });
  // Where a remote environment leaves a window with no session (the server
  // sends / to /pair off loopback; org-join opens /pair itself).
  await win.loadURL(`${origin}/pair`);
  await new Promise((r) => setTimeout(r, 1500));
  log(`window shows ${win.webContents.getURL()}`);

  const loopback = await signIn.startLoopbackReturn({ log });
  const start = await fetch(signIn.desktopStartUrl(origin, loopback.returnTo), { redirect: "manual" });
  const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc=")).split(";")[0];
  const authorize = await fetch(start.headers.get("location"), { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location"), { redirect: "manual", headers: { cookie: binding } });
  const landing = new URL(callback.headers.get("location"));
  await fetch(`${landing.origin}${landing.pathname}`);
  await fetch(`${landing.origin}${landing.pathname}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: landing.origin },
    body: new URLSearchParams(landing.hash.slice(1)).toString(),
  });
  const outcome = await loopback.result;
  if (!outcome.code) throw new Error(`no credential: ${JSON.stringify(outcome)}`);
  const parsed = { origin, code: outcome.code };
  handoff.accept(parsed);
  const target = oldTarget ? `${origin}/pair#code=${outcome.code}&auto=1` : signIn.authReturnTarget(parsed);
  log(`delivering ${signIn.redactedTarget(target)}${oldTarget ? " (old target)" : ""}`);
  await win.loadURL(target).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  const url = win.webContents.getURL();
  const session = await win.webContents.executeJavaScript("fetch('/api/auth/session', { credentials: 'same-origin' }).then(r => r.json())");
  const signedIn = session && session.identity === "perspicax";
  log(`window now ${signIn.redactedTarget(url)}; session ${signedIn ? `signed in (${session.role})` : "signed out"}`);
  const ok = oldTarget ? !signedIn : signedIn && new URL(url).pathname === "/";
  console.log(`[verify] ${ok ? "PASS" : "FAIL"}${oldTarget ? " (old target stays signed out, as reported)" : ""}`);
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.log(`[verify] FAIL ${error.message}`);
  app.exit(1);
});
