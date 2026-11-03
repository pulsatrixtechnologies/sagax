// Real-Electron check of the desktop bridge's egress through system proxies
// (electron/desktop-tunnel.mjs). Electron's own session answers which proxy a
// destination takes (fixed SOCKS5 rules, then a PAC file served locally), and
// the tunnel's connector goes through a local SOCKS5 proxy that asks for a
// user name and password, to a local echo server. Nothing leaves this
// computer; ports are ephemeral (never 18790, 5199, 8799 or 8800).
//
//   pnpm exec electron scripts/verify/dev/verify-desktop-proxy.electron.mjs
import { app, session } from "electron";
import http from "node:http";
import net from "node:net";

import { openConnection, proxyChain, proxyCredentialsFromEnv, proxyQueryUrl } from "../../../electron/desktop-tunnel.mjs";

app.whenReady().then(async () => {
  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push(ok);
    console.log(`[verify-proxy] ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  };
  const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

  // The destination: answers "hello:" then echoes.
  const echo = net.createServer(socket => { socket.on("error", () => {}); socket.write("hello:"); socket.pipe(socket); });
  const echoPort = await listen(echo);

  // A SOCKS5 proxy that requires ada / s3cret (RFC 1928 + 1929) and relays
  // every CONNECT to the echo server, remembering what was asked.
  const asked = [];
  const socks = net.createServer(socket => {
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    let stage = "greeting";
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === "greeting" && buffer.length >= 2 + buffer[1]) {
        const methods = [...buffer.subarray(2, 2 + buffer[1])];
        buffer = buffer.subarray(2 + buffer[1]);
        if (!methods.includes(2)) { socket.end(Buffer.from([5, 0xff])); return; }
        socket.write(Buffer.from([5, 2])); stage = "auth";
      }
      if (stage === "auth" && buffer.length >= 2 && buffer.length >= 3 + buffer[1] && buffer.length >= 3 + buffer[1] + buffer[2 + buffer[1]]) {
        const user = buffer.subarray(2, 2 + buffer[1]).toString();
        const pass = buffer.subarray(3 + buffer[1], 3 + buffer[1] + buffer[2 + buffer[1]]).toString();
        buffer = buffer.subarray(3 + buffer[1] + buffer[2 + buffer[1]]);
        const ok = user === "ada" && pass === "s3cret";
        socket.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) { socket.end(); return; }
        stage = "request";
      }
      if (stage === "request" && buffer.length >= 5) {
        const type = buffer[3];
        const length = type === 1 ? 4 : type === 4 ? 16 : 1 + buffer[4];
        if (buffer.length < 4 + length + 2) return;
        asked.push(`${type === 3 ? buffer.subarray(5, 5 + buffer[4]).toString() : "ip"}:${buffer.readUInt16BE(4 + length)}`);
        buffer = buffer.subarray(4 + length + 2);
        stage = "relay";
        socket.off("data", onData);
        const upstream = net.connect({ host: "127.0.0.1", port: echoPort }, () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (buffer.length) upstream.write(buffer);
          socket.pipe(upstream); upstream.pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
      }
    };
    socket.on("data", onData);
  });
  const socksPort = await listen(socks);

  // The PAC file the "operating system" names: corp hosts through SOCKS5,
  // everything else direct.
  const pac = `function FindProxyForURL(url, host) { return dnsDomainIs(host, ".corp") ? "SOCKS5 127.0.0.1:${socksPort}; DIRECT" : "DIRECT"; }`;
  const pacServer = http.createServer((req, res) => { res.setHeader("content-type", "application/x-ns-proxy-autoconfig"); res.end(pac); });
  const pacPort = await listen(pacServer);

  const exchange = (socket, text) => new Promise((resolve, reject) => {
    let got = "";
    const timer = setTimeout(() => reject(new Error("no answer")), 5000);
    socket.on("data", chunk => { got += chunk; if (got.length >= 6 + text.length) { clearTimeout(timer); socket.destroy(); resolve(got); } });
    socket.on("error", reject);
    socket.resume();
    socket.write(text);
  });

  let exitCode = 1;
  try {
    const net0 = session.fromPartition("verify-proxy");
    const credentials = proxyCredentialsFromEnv({ ALL_PROXY: `socks5h://ada:s3cret@127.0.0.1:${socksPort}` });

    await net0.setProxy({ proxyRules: `socks5://127.0.0.1:${socksPort}` });
    const fixed = await net0.resolveProxy(proxyQueryUrl("app.corp", 443));
    check("fixed SOCKS5 system rules come back from Electron as SOCKS5", proxyChain(fixed)[0]?.type === "socks5", fixed);
    const { socket, via } = await openConnection("app.corp", 443, null, proxyChain(fixed), { credentials });
    check("the connection goes through the SOCKS5 proxy with its password", via === `socks5 127.0.0.1:${socksPort}` && (await exchange(socket, "ping")) === "hello:ping", via);
    check("the proxy resolved the name itself", asked.at(-1) === "app.corp:443", asked.at(-1));
    let refused = false;
    try { await openConnection("app.corp", 443, null, proxyChain(fixed)); } catch (error) { refused = /user name and password/.test(error.message); }
    check("without the password the proxy refuses, and nothing goes direct", refused);

    await net0.setProxy({ mode: "pac_script", pacScript: `http://127.0.0.1:${pacPort}/proxy.pac` });
    const corp = await net0.resolveProxy(proxyQueryUrl("wiki.corp", 8443));
    const outside = await net0.resolveProxy(proxyQueryUrl("example.test", 443));
    check("a PAC file sends corp hosts through SOCKS5, then DIRECT as its fallback", JSON.stringify(proxyChain(corp).map(route => route.type)) === JSON.stringify(["socks5", "direct"]), corp);
    check("a PAC file sends other hosts direct", JSON.stringify(proxyChain(outside)) === JSON.stringify([{ type: "direct" }]), outside);
    const pacRoute = await openConnection("wiki.corp", 8443, null, proxyChain(corp), { credentials });
    check("the PAC route connects through the proxy", pacRoute.via.startsWith("socks5") && (await exchange(pacRoute.socket, "pac")) === "hello:pac", pacRoute.via);

    exitCode = checks.every(Boolean) ? 0 : 1;
  } catch (error) {
    console.log(`[verify-proxy] FAIL ${error?.stack ?? error}`);
  } finally {
    echo.close(); socks.close(); pacServer.close();
    console.log(exitCode ? "[verify-proxy] some checks FAILED" : "[verify-proxy] system proxies: all checks passed");
    app.exit(exitCode);
  }
});
