// The native log must keep the shape of a session-setup message and lose the
// credential values. These tests use the exact shapes the drivers actually
// write — the ACP `env: [{name,value}]` wire form and the claude mcpServers
// object form — so a change to either shape breaks the test, not the secret.
import { describe, expect, it } from "vitest";

import { maskValues } from "../shared/redact.ts";
import { redactSecrets, restoreMaskedSecrets } from "./redact.ts";

const flat = (value: unknown) => JSON.stringify(value);

describe("redactSecrets", () => {
  it("omits private MCP descriptors even when a credential uses an ordinary header name", () => {
    const descriptor = JSON.stringify({ url: "https://example.test/mcp", headers: { "x-tenant": "private-synthetic-value" } });
    const record = `SAGAX_REMOTE_MCP_CONFIG_${"0".repeat(64)}`;
    const logged = redactSecrets({ params: { mcpServers: [{ env: [{ name: "SAGAX_GATE_UPSTREAM", value: descriptor }] }] }, env: { SAGAX_REMOTE_MCP_SERVER: descriptor, [record]: JSON.stringify({ SAGAX_REMOTE_MCP_SERVER: descriptor }) } });
    expect(flat(logged)).not.toContain("private-synthetic-value");
    expect(flat(logged)).toContain("SAGAX_GATE_UPSTREAM");
    expect(flat(logged)).toContain(record);
  });
  it("masks the tokens in an ACP session/new, keeping the shape", () => {
    const sessionNew = {
      jsonrpc: "2.0",
      id: 3,
      method: "session/new",
      params: {
        cwd: "/Users/someone",
        mcpServers: [
          {
            name: "agents",
            command: "/usr/bin/node",
            args: ["/app/agents-proxy.js"],
            env: [
              { name: "SAGAX_BOT_ID", value: "bot-123" },
              { name: "SAGAX_COMMS_TOKEN", value: "s3cret-comms-token-value" },
            ],
          },
          {
            name: "computer",
            command: "/usr/bin/node",
            args: ["/app/computer-proxy.js"],
            env: [
              { name: "OGB_BOX_ID", value: "boat-9" },
              { name: "OGB_BOX_TOKEN", value: "box_live_abcdefghijklmnop" },
            ],
          },
        ],
      },
    };

    const out = flat(redactSecrets(sessionNew));

    expect(out).not.toContain("s3cret-comms-token-value");
    expect(out).not.toContain("box_live_abcdefghijklmnop");
    // shape survives: still the same method, servers, names and non-secret env
    expect(out).toContain("session/new");
    expect(out).toContain("SAGAX_COMMS_TOKEN");
    expect(out).toContain("OGB_BOX_TOKEN");
    expect(out).toContain("bot-123");
    expect(out).toContain("boat-9");
    expect(out).toContain("/app/agents-proxy.js");
    // and it says how long the value was, which is what you debug with
    expect(out).toContain("«redacted 24 chars»");
  });

  it("masks a Composio key in an MCP header and an env object", () => {
    const config = {
      mcpServers: {
        composio: {
          type: "http",
          url: "https://app.composio.dev/tool_router/v3/trs_test/mcp",
          headers: { "x-api-key": "ak_live_supersecret" },
        },
        computer: { env: { ELECTRON_RUN_AS_NODE: "1", OGB_BOX_TOKEN: "box_live_zzz" } },
      },
    };

    const out = flat(redactSecrets(config));
    expect(out).not.toContain("ak_live_supersecret");
    expect(out).not.toContain("box_live_zzz");
    expect(out).toContain("app.composio.dev");
    expect(out).toContain("ELECTRON_RUN_AS_NODE");
    expect(out).toContain('"1"'); // a non-secret value is untouched
  });

  it("still content-redacts an ACP env entry whose name is not secret-shaped", () => {
    // A credential can land under an ordinary-looking variable name (a
    // custom env var, a feature flag someone repurposed) — the ACP
    // {name,value} shortcut must not skip the content pass just because
    // the NAME alone doesn't scream "secret".
    const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
    const leaked = `sk-ant-api03-${alpha}`;
    const sessionNew = {
      params: {
        mcpServers: [
          {
            name: "custom",
            env: [
              { name: "SESSION_CONFIG", value: leaked },
              { name: "FEATURE_FLAG", value: "enabled" },
            ],
          },
        ],
      },
    };

    const out = flat(redactSecrets(sessionNew));
    expect(out).not.toContain(leaked);
    expect(out).toContain("SESSION_CONFIG");
    expect(out).toContain("FEATURE_FLAG");
    expect(out).toContain("enabled");
    expect(out).toMatch(/«redacted \d+ chars»/);
  });

  it("leaves ordinary protocol traffic alone", () => {
    const update = {
      method: "session/update",
      params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "the key to this bug" } } },
    };
    expect(redactSecrets(update)).toEqual(update);
  });

  it("does not mangle words that merely contain 'key'", () => {
    const msg = { keyboard: "cmd+k", monkey: "business", keys: "SECRET-LIST", hotkey: "ctrl" };
    const out = redactSecrets(msg) as Record<string, string>;
    expect(out.keyboard).toBe("cmd+k");
    expect(out.monkey).toBe("business");
    expect(out.hotkey).toBe("ctrl");
    // `keys` standing alone IS treated as a credential holder
    expect(out.keys).toContain("redacted");
  });

  it("survives cycles-adjacent depth and non-objects", () => {
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(42)).toBe(42);
    let deep: Record<string, unknown> = { token: "deep-secret" };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });
});

import { redactSecretsInText } from "./redact.ts";

// Content-shaped secrets: what a bot's own reply, a tool title, or a
// permission card can carry. High precision on purpose — a false positive
// here rewrites real code in the transcript.
describe("redactSecretsInText", () => {
  it("masks known key prefixes wherever they appear", () => {
    // fixtures are assembled at runtime so no token-shaped literal sits in
    // the source — GitHub's push protection (rightly) flags those
    const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
    const cases: Array<[string, RegExp]> = [
      [`set ANTHROPIC_API_KEY=sk-ant-api03-${alpha}`, /sk-ant/],
      [`OpenAI: sk-proj-${alpha}ABCD`, /sk-proj/],
      [`gh token ${"gh" + "p_"}${alpha}`, /ghp_/],
      [`fine-grained ${"github_" + "pat_"}11ABCDEFG0${alpha}`, /github_pat_/],
      [`slack ${"xox" + "b-"}${"123456789012"}-${"1234567890123"}-${alpha.slice(0, 24)}`, /xoxb-/],
      [`slack app ${"xa" + "pp-"}1-A0123456789-${"1234567890123"}-${alpha.slice(0, 24)}`, /xapp-|A0123456789/],
      [`aws ${"AKIA" + "IOSFODNN7EXAMPLE"} and more`, /IOSFODNN7EXAMPLE/],
      [`aws temporary ${"ASIA" + "IOSFODNN7EXAMPLE"} and more`, /IOSFODNN7EXAMPLE/],
      [`google ${"AIza" + "SyA-"}${alpha.slice(0, 32)}`, /AIza/],
      [`npm ${"npm" + "_"}${alpha}`, /npm_[a-z]/],
      [`xai ${"xai-"}${alpha}`, /xai-/],
      [`groq ${"gsk_"}${alpha}ABCD`, /gsk_/],
      [`meta ${"LLM|"}607358788850350|${alpha}`, /LLM\|6073/],
      [`huggingface ${"hf_"}${alpha}`, /hf_/],
      [`pypi ${"py" + "pi-"}AgEIcHlwaS5vcmcCJDAwMDAwMDAwLTAwMDAtMDAwMC0wMDAwLTAwMDAwMDAwMDAwMAACKlszLCJhYmNkZWYiXQAABiBy${alpha}`, /pypi-|AgEIcHlwaS5vcmc/],
      [`stripe ${"sk_" + "live_"}${alpha}`, /sk_live_[a-z]/],
      [`stripe test ${"sk_" + "test_"}${alpha}`, /sk_test_[a-z]/],
      [`stripe restricted ${"rk_" + "live_"}${alpha}`, /rk_live_[a-z]/],
      [`gitlab ${"glp" + "at-"}${alpha.slice(0, 20)}`, /glpat-[a-z]/],
      [`webhook secret ${"whsec" + "_"}${alpha}`, /whsec_[a-z]/],
    ];
    for (const [input, leak] of cases) {
      const out = redactSecretsInText(input);
      expect(out, input).not.toMatch(leak);
      expect(out).toMatch(/«redacted \d+ chars»/);
    }
  });

  // upstream #5428
  it("masks Notion integration tokens", () => {
    // ntn_ plus 46 letters and digits, assembled at runtime like the cases above.
    const token = `${"nt" + "n_"}${"0123456789A"}${"bcdefghijklmnopqrstuvwxyzABCDEFGHIJ"}`;
    expect(redactSecretsInText(`notion ${token} connected`)).toBe(`notion «redacted ${token.length} chars» connected`);
    expect(holdsCredential(`header Notion ${token}`)).toBe(true);
    for (const ordinary of ["ntn_example", `${"nt" + "n_"}${"a".repeat(39)}`, `example_${"nt" + "n_"}${"a".repeat(46)}`]) {
      expect(redactSecretsInText(ordinary)).toBe(ordinary);
      expect(holdsCredential(ordinary)).toBe(false);
    }
  });

  // upstream #5510
  it("masks Perplexity API keys", () => {
    // pplx- plus 48 letters and digits, assembled at runtime like the cases above.
    const key = `${"pp" + "lx-"}${"0123456789ABCDEFGHIJKLMN"}${"opqrstuvwxyzabcdefghijkl"}`;
    expect(redactSecretsInText(`perplexity ${key} search`)).toBe(`perplexity «redacted ${key.length} chars» search`);
    expect(holdsCredential(`search via ${key}`)).toBe(true);
    for (const ordinary of ["perplexity/pplx-decider-v1.1-27b", `${"pp" + "lx-"}${"a".repeat(47)}`, `${"pp" + "lx-"}${"a".repeat(49)}`, `example_${"pp" + "lx-"}${"a".repeat(48)}`]) {
      expect(redactSecretsInText(ordinary)).toBe(ordinary);
      expect(holdsCredential(ordinary)).toBe(false);
    }
  });

  it("masks SendGrid API keys", () => {
    // SG.<22-char key id>.<43-char secret>, assembled at runtime like the cases above.
    const key = `${"S" + "G."}${"abcdefghij0123456789_-"}.${"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij0123456"}`;
    expect(redactSecretsInText(`sendgrid ${key} sent`)).toBe(`sendgrid «redacted ${key.length} chars» sent`);
    expect(holdsCredential(`mail via ${key}`)).toBe(true);
    for (const ordinary of ["SG.example.com", `${"S" + "G."}${"a".repeat(22)}.${"b".repeat(20)}`, `${"S" + "G."}${"a".repeat(22)}.${"b".repeat(44)}`, "Use the SG. prefix for the key"]) {
      expect(redactSecretsInText(ordinary)).toBe(ordinary);
      expect(holdsCredential(ordinary)).toBe(false);
    }
  });

  it.each([
    ["xai-", 20],
    ["gsk_", 40],
    ["hf_", 30],
  ] as const)("bounds %s masking without changing ordinary text", (prefix, minimum) => {
    const key = prefix + "a".repeat(minimum);
    const longer = key + "AB12";
    const text = `before "${key}", ${longer}; after ✓`;
    const expected = `before "«redacted ${key.length} chars»", «redacted ${longer.length} chars»; after ✓`;

    expect(redactSecretsInText(text)).toBe(expected);
    expect(redactSecretsInText(expected)).toBe(expected);
    expect(redactSecrets({ note: text })).toEqual({ note: expected });
    for (const ordinary of [prefix + "a".repeat(minimum - 1), `example_${key}`, `${prefix}example`]) {
      expect(redactSecretsInText(ordinary)).toBe(ordinary);
    }
  });

  it("masks JWTs, PEM private key blocks, and bearer tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactSecretsInText(`token ${jwt} ok`)).toBe(`token «redacted ${jwt.length} chars» ok`);
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n-----END OPENSSH PRIVATE KEY-----";
    const out = redactSecretsInText(`here:\n${pem}\ndone`);
    expect(out).not.toContain("b3BlbnNzaC1r");
    expect(out).toMatch(/BEGIN OPENSSH PRIVATE KEY[\s\S]*«redacted \d+ chars»[\s\S]*END OPENSSH PRIVATE KEY/);
    expect(redactSecretsInText('curl -H "Authorization: Bearer abc.def-ghi_jkl123456789"')).toBe('curl -H "Authorization: Bearer «redacted 24 chars»"');
  });

  it("masks two PEM blocks apart and stays linear on many unclosed BEGIN lines", () => {
    const block = (body: string) => `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;
    const two = redactSecretsInText(`${block("Zmlyc3Qtc2VjcmV0LWJvZHk")}\nbetween\n${block("c2Vjb25kLXNlY3JldC1ib2R5")}`);
    expect(two).not.toContain("Zmlyc3Qtc2VjcmV0");
    expect(two).not.toContain("c2Vjb25kLXNlY3Jl");
    expect(two).toContain("\nbetween\n");
    const hostile = "-----BEGIN PRIVATE KEY-----a".repeat(20_000);
    const started = performance.now();
    expect(redactSecretsInText(hostile)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("is byte-for-byte idempotent for PEM blocks", () => {
    const privateKeyBody = "c3VwZXItc2VjcmV0LXByaXZhdGUta2V5LWJ5dGVz";
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      privateKeyBody,
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const once = redactSecretsInText(`before\n${pem}\nafter`);

    expect(redactSecretsInText(once)).toBe(once);
    expect(once).toContain(`«redacted ${privateKeyBody.length} chars»`);
  });

  it("masks the value of a secret-shaped key=value or key: value, keeping the key", () => {
    expect(redactSecretsInText("export DATABASE_PASSWORD=hunter2hunter2")).toBe("export DATABASE_PASSWORD=«redacted 14 chars»");
    expect(redactSecretsInText('{"api_key": "abcd1234efgh5678"}')).toBe('{"api_key": "«redacted 16 chars»"}');
    expect(redactSecretsInText("client_secret: 'zzzz-yyyy-xxxx-1'")).toBe("client_secret: '«redacted 16 chars»'");
    expect(redactSecretsInText("--token=abc123def456")).toBe("--token=«redacted 12 chars»");
  });

  it("masks an assignment to any name ending in KEY, whatever the value looks like", () => {
    expect(redactSecretsInText(`OPENAI_API_KEY=sk-${"a".repeat(20)} pnpm test`)).toBe("OPENAI_API_KEY=«redacted 23 chars» pnpm test");
    expect(redactSecretsInText("X_KEY=value pnpm control:omb doctor")).toBe("X_KEY=«redacted 5 chars» pnpm control:omb doctor");
    expect(redactSecretsInText("export xai-key='abc.def'")).toBe("export xai-key='«redacted 7 chars»'");
  });

  it("masks the password in a URL's userinfo, keeping the user and the host", () => {
    expect(redactSecretsInText("psql postgres://maus:s3cret@db.internal:5432/app")).toBe("psql postgres://maus:«redacted 6 chars»@db.internal:5432/app");
    expect(redactSecretsInText("curl https://user:p%40ss@host/path")).toBe("curl https://user:«redacted 6 chars»@host/path");
  });

  it("masks the value of a secret-naming flag, in both spellings", () => {
    expect(redactSecretsInText("gh auth login --token abc123")).toBe("gh auth login --token «redacted 6 chars»");
    expect(redactSecretsInText("tool --password=hunter2 --api-key 'k1' --secret s")).toBe("tool --password=«redacted 7 chars» --api-key '«redacted 2 chars»' --secret «redacted 1 chars»");
    // a flag followed by another flag has no value to mask
    expect(redactSecretsInText("tool --token --verbose")).toBe("tool --token --verbose");
  });

  it("does not mask ordinary words near those rules", () => {
    for (const s of [
      "hotkey=cmd+k keyboard=qwerty monkey=business",
      "https://host:8080/path and user@host",
      "git log --tokens-are-not-a-flag --passwords",
      "the key: patience",
    ]) {
      expect(redactSecretsInText(s), s).toBe(s);
    }
  });

  it("leaves ordinary text, code, hashes and URLs alone", () => {
    for (const s of [
      "the keyboard shortcut is cmd-k",
      "git commit 3f2a9c1e7b4d5a6f8e9c0b1a2d3e4f5a6b7c8d9e",
      "https://example.com/path?page=2&sort=asc",
      "const token = await getToken(); // fetches later",
      "password: (leave blank to keep the current one)",
      "Bearer tokens are sent in the Authorization header",
      "sk-8", // too short to be a key
    ]) {
      expect(redactSecretsInText(s), s).toBe(s);
    }
  });

  it("is applied to string values inside redactSecrets too", () => {
    const out = redactSecrets({ command: "curl -H 'Authorization: Bearer abcdefghijklmnop'", note: "fine" }) as Record<string, string>;
    expect(out.command).toContain("«redacted");
    expect(out.note).toBe("fine");
  });

  it("is idempotent for structurally identified credentials", () => {
    const input = {
      apiKey: "abcdefgh12345678",
      env: [{ name: "SAGAX_COMMS_TOKEN", value: "abcdefghijklmnop" }],
    };
    const once = redactSecrets(input);

    expect(redactSecrets(once)).toEqual(once);
  });
});

describe("redactSecrets: Slack app-level tokens (upstream #4065)", () => {
  it("masks an xapp- token", () => {
    const token = `${"xa" + "pp-"}1-A0123456789-1234567890123-abcdef0123456789`;
    expect(redactSecrets(`SLACK_APP_TOKEN: ${token}`)).not.toContain(token);
  });
});

describe("redactSecrets: GitLab tokens and Basic credentials (upstream #3926, #3985)", () => {
  it("masks GitLab personal, deploy and runner tokens", () => {
    for (const token of [`${"glp" + "at-"}0123456789abcdefABCD`, `${"gld" + "t-"}0123456789abcdefABCD`, `${"glr" + "tr-"}0123456789abcdefABCD`]) {
      expect(redactSecrets(`token ${token}`)).not.toContain(token);
    }
  });
  it("masks Basic credentials after an Authorization header only", () => {
    expect(redactSecrets("Authorization: Basic dXNlcjpwYXNzd29yZA==")).not.toContain("dXNlcjpwYXNzd29yZA==");
    expect(redactSecrets("Basic configuration of the router")).toBe("Basic configuration of the router");
  });
});

import {
  addHeldSecretScrubber,
  holdsCredential,
  HELD_SECRET_MASK,
  redactCutSecrets,
} from "./redact.ts";

describe("redactSecrets: webhook secrets and cut key starts (Lot A0)", () => {
  it("masks whsec_ webhook secrets alone or in an automation address", () => {
    const alpha = "abcdefghijklmnopqrstuvwxyz012345";
    const secret = `${"whsec" + "_"}${alpha}`;
    expect(redactSecretsInText(`webhook secret ${secret}`)).not.toMatch(/whsec_[a-z]/);
    expect(redactSecretsInText(`http://127.0.0.1:8800/hooks/wh_abc/${secret}-_x`)).not.toMatch(/whsec_[a-z]/);
  });

  it("masks cut key starts for xapp- and glpat- before an ellipsis", () => {
    const xapp = `${"xa" + "pp-"}1-A0123456789`;
    const glpat = `${"glp" + "at-"}0123456789ab`;
    const whsec = `${"whsec" + "_"}${ "abcd".repeat(5)}`;
    expect(redactCutSecrets(`slack ${xapp}…`)).not.toContain(xapp);
    expect(redactCutSecrets(`gitlab ${glpat}…`)).not.toContain(glpat);
    expect(redactCutSecrets(`hook ${whsec}…`)).not.toContain(whsec);
    expect(redactCutSecrets(`slack ${xapp}…`)).toMatch(/«redacted \d+ chars»…/);
  });
});

describe("holdsCredential (Lot A0 / upstream tip)", () => {
  it("knows a provider key or a private key block, never a name, a placeholder or code that reads one", () => {
    for (const text of [
      `TWINE_PASSWORD: ${"py" + "pi-"}AgENdGVzdC5weXBpLm9yZwIkMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwAAIqWzMsImFiY2RlZiJdAAAGIA`,
      '{"apiKey": "sk-ant-api03-0123456789abcdefABCD"}',
      "GITHUB_TOKEN=ghp_0123456789abcdefghij0123",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
      "aws_access_key_id = AKIAABCDEFGHIJKLMNOP",
      `temporary aws key ${"ASIA" + "ABCDEFGHIJKLMNOP"}`,
      `git clone https://oauth2:${"glp" + "at-"}0123456789abcdefABCD@gitlab.example.com/x.git`,
      `SLACK_APP_TOKEN: ${"xa" + "pp-"}1-A0123456789-1234567890123-abcdef0123456789`,
      `stripe.secret = "${"sk_" + "live_"}0123456789abcdefABCD"`,
      `webhook ${"whsec" + "_"}${"abcdefghijklmnopqrst"}`,
    ]) expect(holdsCredential(text), text).toBe(true);
    for (const text of [
      "token = os.environ['GITHUB_TOKEN']",
      "API_KEY=your-key-here",
      "Authorization: Bearer YOUR_TOKEN_HERE",
      "Keep credentials out of the repo.",
      "-----BEGIN PUBLIC KEY-----",
      "GITLAB_TOKEN=glpat-your-token-here",
      `release notes mention ${"py" + "pi-"}AgE${"x".repeat(60)}`,
    ]) expect(holdsCredential(text), text).toBe(false);
  });
});

describe("held secret scrubber API (Lot A0)", () => {
  it("runs registered scrubbers before pattern redaction, including short values", () => {
    const leaked = "pw99";
    const remove = addHeldSecretScrubber((text) => text.split(leaked).join(HELD_SECRET_MASK));
    try {
      expect(redactSecretsInText(`login ${leaked}`)).toBe(`login ${HELD_SECRET_MASK}`);
      expect(redactSecretsInText(leaked)).toBe(HELD_SECRET_MASK);
    } finally {
      remove();
    }
  });
});

describe("#4081: the sandbox bridge token", () => {
  it("is masked in a command's output, alone or in env output, and only at its full length", () => {
    // assembled at runtime, never a token-shaped literal in the source
    const token = `${"sgx_" + "brg_"}${"Ab1-_".repeat(8)}xyz`;
    expect(token).toHaveLength(8 + 43);
    for (const text of [token, `SAGAX_BRIDGE_TOKEN=${token}\nPATH=/usr/bin`, `echo: ${token}.`]) {
      const out = redactSecretsInText(text);
      expect(out).not.toContain(token);
      expect(out).not.toContain("Ab1-_Ab1-_");
    }
    // a shorter look-alike is not a token
    const short = `${"sgx_" + "brg_"}abc`;
    expect(redactSecretsInText(`see ${short}`)).toContain(short);
  });
});

// upstream #5282: values masked in one pass over the original text.
describe("maskValues", () => {
  it("masks crossing, nested and self-overlapping values whole", () => {
    expect(maskValues("abcdefghi", ["abc", "bcdefghi"], "[r]")).toBe("[r]");
    expect(maskValues("x ababa y", ["aba"], "[r]")).toBe("x [r] y");
    expect(maskValues("prefix-sensitive-suffix / prefix", ["prefix", "prefix-sensitive-suffix"], "[r]")).toBe("[r] / [r]");
    expect(maskValues("keep a.b+c here", ["a.b+c", ""], "[r]")).toBe("keep [r] here");
    expect(maskValues("nothing", ["absent"], "[r]")).toBe("nothing");
  });
});

describe("numbered masks read back (#4971)", () => {
  // Fake keys, same length (49), so a pairing by length alone is ambiguous.
  const a = "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const b = "sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const c = "sk-ant-api03-cccccccccccccccccccc";
  const original = `First use ${a} on the queue.\nThen use ${b} on the archive.`;
  const read = () => redactSecretsInText(original, { numbered: true });

  it("numbers each mask and keeps the plain form for every other reader", () => {
    expect(read()).toBe("First use «redacted #1, 49 chars» on the queue.\nThen use «redacted #2, 49 chars» on the archive.");
    expect(redactSecretsInText(original)).toBe("First use «redacted 49 chars» on the queue.\nThen use «redacted 49 chars» on the archive.");
    // a numbered text scrubbed again (the proposal path) stays as it is
    expect(redactSecretsInText(read())).toBe(read());
  });

  it("text sent back unchanged gives back the original", () => {
    expect(restoreMaskedSecrets(original, read())).toBe(original);
  });

  it("one of two masks removed: the other keeps its own secret", () => {
    const sent = read().replace("First use «redacted #1, 49 chars» on the queue.\n", "");
    expect(restoreMaskedSecrets(original, sent)).toBe(`Then use ${b} on the archive.`);
  });

  it("two masks moved: each keeps its own secret", () => {
    const sent = "Archive: «redacted #2, 49 chars». Queue: «redacted #1, 49 chars».";
    expect(restoreMaskedSecrets(original, sent)).toBe(`Archive: ${b}. Queue: ${a}.`);
  });

  it("plain masks of the same length, one removed: the other stays a mask, never the wrong key", () => {
    const sent = "Then use «redacted 49 chars» on the archive.";
    expect(restoreMaskedSecrets(original, sent)).toBe(sent);
  });

  it("a plain mask with a single value of its length takes that value", () => {
    const mixed = `Use ${a} then ${c}.`;
    expect(restoreMaskedSecrets(mixed, "Only «redacted 33 chars» now.")).toBe(`Only ${c} now.`);
  });

  it("masks side by side form one numbered span restored whole, its length hidden", () => {
    const held = "hunter2-fake-held";
    const stop = addHeldSecretScrubber((text) => text.split(held).join(HELD_SECRET_MASK));
    try {
      const glued = `Keys ${a}${held} then ${b}.`;
      expect(redactSecretsInText(glued)).toBe(`Keys «redacted 49 chars»${HELD_SECRET_MASK} then «redacted 49 chars».`);
      const masked = redactSecretsInText(glued, { numbered: true });
      expect(masked).toBe("Keys «redacted #1» then «redacted #2, 49 chars».");
      expect(restoreMaskedSecrets(glued, masked)).toBe(glued);
      expect(restoreMaskedSecrets(glued, "Swap «redacted #2, 49 chars» and «redacted #1».")).toBe(`Swap ${b} and ${a}${held}.`);
    } finally {
      stop();
    }
  });

  it("text without masks is returned as received", () => {
    expect(restoreMaskedSecrets(original, "Brand new instructions.")).toBe("Brand new instructions.");
  });

  it("an invented mask is kept as received", () => {
    const sent = "Use «redacted #7, 49 chars» and «redacted #1, 12 chars» and «redacted 20 chars».";
    expect(restoreMaskedSecrets(original, sent)).toBe(sent);
  });
});
