// Port of OpenMausBot #2930: only the app window's session reaches the local server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";

import { reportOwnListeners, serverRequestRefusal, targetsServer } from "./server-session.mjs";
import { installSessionBlock } from "./upstream-hosts.mjs";

const SERVER_PORT = 48799;

function fakeSession() {
  const hooks = {};
  return { hooks, webRequest: { onBeforeRequest: (handler) => { hooks.request = handler; } } };
}

const request = (session, url) => new Promise((resolve) => session.hooks.request({ url }, (result) => resolve(result.cancel)));

test("no session but the app window's may reach the server, in any spelling of this machine, and the upstream block still holds", async () => {
  const defaultSession = fakeSession();
  let guard = null;
  const viewer = fakeSession();
  installSessionBlock(viewer, () => {}, serverRequestRefusal(viewer, () => guard));
  installSessionBlock(defaultSession, () => {}, serverRequestRefusal(defaultSession, () => guard));
  guard = { defaultSession, serverPort: () => SERVER_PORT };
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "app.localhost", "[::1]", "[::ffff:127.0.0.1]", "0.0.0.0"]) {
    for (const scheme of ["http", "ws", "https", "wss"]) {
      assert.equal(await request(viewer, `${scheme}://${host}:${SERVER_PORT}/api/bots`), true, `${scheme} ${host}`);
    }
  }
  for (const url of ["http://127.0.0.1:6080/vnc.html", "https://desktop.example/vnc.html", `http://10.0.0.5:${SERVER_PORT}/`, "data:text/html,x"]) {
    assert.equal(await request(viewer, url), false, url);
  }
  // One listener per session: the upstream-hosts rule shares it.
  assert.equal(await request(viewer, "https://github.com/milind-soni/OpenMausBot"), true);
  assert.equal(await request(defaultSession, `http://127.0.0.1:${SERVER_PORT}/api/bots`), false, "the app window's own session is never cancelled");
  assert.equal(targetsServer(`http://2130706433:${SERVER_PORT}/`, SERVER_PORT), true);
});

test("main.mjs sets the guard before the first window, and sends the owner header on ws: too", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const install = main.indexOf("serverSessionGuard = { defaultSession: session.defaultSession");
  assert.ok(install > 0);
  assert.match(main, /installSessionBlock\(created, \(line\) => slog\(`network: \$\{line\}`\), serverRequestRefusal\(created, \(\) => serverSessionGuard\)\)/);
  assert.ok(main.indexOf("createWindow();", install) > install, "set before the first window");
  assert.match(main, /target\.protocol === "http:" \|\| target\.protocol === "ws:"/);
  assert.match(main, /reportOwnListeners\(proc\);/);
});

test("the server hears about every port this app listens on, and about new ones as they open", async () => {
  const messages = [];
  reportOwnListeners({ postMessage: (message) => messages.push(message) }, [8810]);
  assert.equal(messages.at(-1).type, "openmausbot:own-listeners");
  assert.ok(messages.at(-1).ports.includes(8810));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.ok(messages.at(-1).ports.includes(server.address().port));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
