import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DESKTOP_MUTATION_HEADER, forwardBootUiRequest } from "./boot-ui-forward.mjs";

const TOKEN = "b".repeat(43);
const ORIGIN = "http://127.0.0.1:8799";

test("boot-ui forward without the helper leaves a browser mutation unauthenticated", async () => {
  // Mirrors the race: protocol.handle skips webRequest, so the forwarded
  // Request keeps Sec-Fetch-* and never gains the owner header.
  const incoming = new Request(`${ORIGIN}/api/auth/stream-ticket`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
  });
  assert.equal(incoming.headers.get(DESKTOP_MUTATION_HEADER), null);
});

test("boot-ui forward adds the owner capability before net.fetch", async () => {
  const incoming = new Request(`${ORIGIN}/api/auth/stream-ticket`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
  });
  let forwarded = null;
  await forwardBootUiRequest(incoming, { bypassCustomProtocolHandlers: true }, {
    token: TOKEN,
    fetch: async (request, init) => {
      forwarded = { request, init };
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(forwarded.request.headers.get(DESKTOP_MUTATION_HEADER), TOKEN);
  assert.equal(forwarded.request.headers.get("sec-fetch-site"), "same-origin");
  assert.equal(forwarded.request.method, "POST");
  assert.equal(forwarded.init.bypassCustomProtocolHandlers, true);
});

test("boot-ui forward rejects an invalid packaged token", () => {
  assert.throws(
    () => forwardBootUiRequest(new Request(`${ORIGIN}/api/health`), {}, {
      token: "short",
      fetch: async () => new Response("ok"),
    }),
    /invalid desktop mutation capability/,
  );
});

test("main.mjs wires boot-ui forward through the owner capability helper", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /import \{ forwardBootUiRequest \} from "\.\/boot-ui-forward\.mjs";/);
  assert.match(main, /forwardBootUiRequest\(request, init, \{\s*fetch: \(input, forwardInit\) => net\.fetch\(input, forwardInit\),\s*token: desktopMutationToken,/);
  assert.match(main, /refusalCode: refusal && typeof refusal === "object" \? refusal\.code \?\? null : null/);
});
