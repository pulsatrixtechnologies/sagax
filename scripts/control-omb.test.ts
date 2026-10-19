// What crosses from the launching shell into a fixture server: only what a
// test scripted on purpose. A real OpenAI key must never reach a fixture that
// could send it to OpenAI.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { verificationServerEnvironment } from "./control-omb.ts";

const childEnv = (parentEnv: NodeJS.ProcessEnv) => verificationServerEnvironment(parentEnv, join(tmpdir(), "omb-fixture-env"), 9100);

describe("the fixture's fake engine knobs", () => {
  it("lets the Claude fake's knobs and the Codex fake's background-call knobs cross, and nothing else", () => {
    const env = childEnv({
      FAKE_CLAUDE_TEXT_ROUTES: "/tmp/routes.json", FAKE_CODEX_TEXT_ROUTES: "/tmp/codex-routes.json", FAKE_CODEX_TEXT_LOG: "/tmp/codex.jsonl",
      FAKE_CODEX_MODE: "approval", FAKE_CODEX_DUMP: "/tmp/codex-dump.json", SOME_SECRET: "x",
    });
    expect(env).toMatchObject({ FAKE_CLAUDE_TEXT_ROUTES: "/tmp/routes.json", FAKE_CODEX_TEXT_ROUTES: "/tmp/codex-routes.json", FAKE_CODEX_TEXT_LOG: "/tmp/codex.jsonl" });
    for (const key of ["FAKE_CODEX_MODE", "FAKE_CODEX_DUMP", "SOME_SECRET"]) expect(env, key).not.toHaveProperty(key);
  });
});

describe("the fixture's Live call environment", () => {
  it("passes a loopback fake GPT-Live and its key through", () => {
    expect(childEnv({ SAGAX_OPENAI_LIVE_URL: " http://127.0.0.1:4100 ", SAGAX_OPENAI_LIVE_KEY: "sk-fake" }))
      .toMatchObject({ SAGAX_OPENAI_LIVE_URL: "http://127.0.0.1:4100", SAGAX_OPENAI_LIVE_KEY: "sk-fake" });
    const noKey = childEnv({ SAGAX_OPENAI_LIVE_URL: "http://127.0.0.1:4100" });
    expect(noKey.SAGAX_OPENAI_LIVE_URL).toBe("http://127.0.0.1:4100");
    expect(noKey).not.toHaveProperty("SAGAX_OPENAI_LIVE_KEY");
  });

  it("drops any other Live URL, and never lets the key cross without the fake", () => {
    for (const url of ["https://api.openai.com", "http://localhost:4100", "http://127.0.0.1:4100/v1", "http://192.0.2.1:4100", "http://127.0.0.1", ""]) {
      const env = childEnv({ SAGAX_OPENAI_LIVE_URL: url, SAGAX_OPENAI_LIVE_KEY: "sk-real" });
      expect(env, url).not.toHaveProperty("SAGAX_OPENAI_LIVE_URL");
      expect(env, url).not.toHaveProperty("SAGAX_OPENAI_LIVE_KEY");
    }
    expect(childEnv({ SAGAX_OPENAI_LIVE_KEY: "sk-real" })).not.toHaveProperty("SAGAX_OPENAI_LIVE_KEY");
  });
});
