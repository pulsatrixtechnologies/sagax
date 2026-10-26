// Two local sites for My Chrome tests: the allowed one (http://localhost:<a>)
// and another one (http://127.0.0.1:<b>), a different host so cookies differ.
// Every request each one gets is logged, so a test can prove a navigation
// never left the browser.
import { createServer, type Server } from "node:http";

export interface FakeSites {
  allowed: string;
  other: string;
  /** Paths with query the other site was asked for. */
  otherHits: string[];
  allowedHits: string[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

export async function startFakeSites(): Promise<FakeSites> {
  const otherHits: string[] = [];
  const allowedHits: string[] = [];
  let otherOrigin = "";
  const other = createServer((req, res) => {
    otherHits.push(req.url ?? "");
    res.setHeader("set-cookie", "other_secret=s3cr3t; Path=/; SameSite=None");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><title>Other site</title><p id="other">other site</p><script>document.cookie = "other_script=visible; path=/";</script>`);
  });
  const allowed = createServer((req, res) => {
    allowedHits.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/away") {
      res.statusCode = 302;
      res.setHeader("location", `${otherOrigin}/?via=redirect`);
      res.end();
      return;
    }
    res.setHeader("set-cookie", "allowed_session=mine; Path=/");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/two") { res.end(`<!doctype html><title>Two</title><p>page two</p>`); return; }
    res.end(`<!doctype html><html lang="en"><title>Allowed</title>
<h1>Account</h1>
<button id="delete" onclick="document.body.dataset.deleted='yes'">Delete account</button>
<button id="pay" onclick="document.body.dataset.paid='yes'">Pay now</button>
<form id="msg" onsubmit="event.preventDefault(); document.body.dataset.sent='yes'"><input id="text" aria-label="Message"><button>Send message</button></form>
<input type="search" id="search" aria-label="Search">
<a id="two" href="/two">Two</a>
<a id="other" href="${otherOrigin}/?via=link">Other site</a>
<a id="away" href="/away">Redirect</a>
<iframe id="frame" src="${otherOrigin}/?via=frame"></iframe>
</html>`);
  });
  const otherPort = await listen(other);
  otherOrigin = `http://127.0.0.1:${otherPort}`;
  const allowedPort = await listen(allowed);
  return {
    allowed: `http://localhost:${allowedPort}`,
    other: otherOrigin,
    otherHits,
    allowedHits,
    close: async () => {
      allowed.closeAllConnections();
      other.closeAllConnections();
      await Promise.all([new Promise((r) => allowed.close(r)), new Promise((r) => other.close(r))]);
    },
  };
}
