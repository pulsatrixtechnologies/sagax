// #4394: a browser task ran 41 steps and 10 minutes on a site that would not
// let the bot in. These pages refuse the way such sites do (a sign-in wall,
// an automation challenge, an access refusal); the bot's first look at one
// must say what blocks it.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OBSERVE_PAGE_SCRIPT, pageBlock, pageBlockNote, parsePageState, type PageState } from "./browser-tool-shape.ts";

const page = (over: Partial<PageState> = {}): PageState => ({ url: "https://social.test/home", title: "Home", text: "Welcome\nLatest posts", ...over });

describe("pageBlock (#4394)", () => {
  it("names a sign-in wall only on a landing page with a visible password field", () => {
    expect(pageBlock(page({ url: "https://social.test/i/flow/login", title: "Log in", text: "Sign in\nPassword", password: true }), { landing: true }))
      .toEqual({ kind: "sign-in", host: "social.test" });
    // The same form mid-login (after a fill) is the bot's own sign-in, not a wall.
    expect(pageBlock(page({ url: "https://social.test/i/flow/login", title: "Log in", text: "Password", password: true }), { landing: false })).toBeNull();
    // A long page with a small login box in a corner is a page to read.
    expect(pageBlock(page({ text: `${"Article line\n".repeat(400)}Password`, password: true }), { landing: true })).toBeNull();
  });

  it("names an automation challenge and an access refusal on any page", () => {
    expect(pageBlock(page({ title: "Just a moment...", text: "Checking your browser before accessing social.test" }), { landing: false }))
      .toEqual({ kind: "challenge", host: "social.test" });
    expect(pageBlock(page({ title: "Home", text: "Verify you are human", challenge: true }), { landing: true })?.kind).toBe("challenge");
    expect(pageBlock(page({ title: "403 Forbidden", text: "Access denied" }), { landing: true })?.kind).toBe("refused");
    expect(pageBlock(page({ title: "Social", text: "Something went wrong.\nWe detected unusual traffic from your network." }), { landing: true })?.kind).toBe("challenge");
  });

  it("leaves an ordinary page alone, an article about captchas included", () => {
    expect(pageBlock(page(), { landing: true })).toBeNull();
    expect(pageBlock(page({ title: "How a CAPTCHA works", text: `${"A captcha asks you to verify you are human. ".repeat(200)}` }), { landing: true })).toBeNull();
  });

  it("never flags a working page whose title or text only looks like a wall (review of #4394)", () => {
    const long = `${"A paragraph of the page. ".repeat(200)}`;
    for (const title of ["Verify your email address", "One more step to finish your order", "401(k) plans explained", "403 ways to cook rice", "Forbidden fruit: a history"]) {
      expect(pageBlock(page({ title, text: long }), { landing: true }), title).toBeNull();
      expect(pageBlock(page({ title, text: long }), { landing: false }), title).toBeNull();
    }
    // Short pages with those titles are ordinary steps too.
    expect(pageBlock(page({ title: "Verify your email address", text: "We sent you a code." }), { landing: true })).toBeNull();
    expect(pageBlock(page({ title: "One more step to finish your order", text: "Shipping address" }), { landing: false })).toBeNull();
    expect(pageBlock(page({ title: "401(k) plans explained", text: "Saving for later." }), { landing: true })).toBeNull();
    // A wall's title on a long page is a page to read.
    expect(pageBlock(page({ title: "Access denied", text: long }), { landing: true })).toBeNull();
    // The real ones still read as walls on a short page.
    expect(pageBlock(page({ title: "Attention Required! | Social", text: "Sorry, you have been blocked" }), { landing: false })?.kind).toBe("challenge");
    expect(pageBlock(page({ title: "Verify you are human", text: "" }), { landing: true })?.kind).toBe("challenge");
    expect(pageBlock(page({ title: "429 Too Many Requests", text: "" }), { landing: true })?.kind).toBe("refused");
    expect(pageBlock(page({ title: "Error 1020", text: "" }), { landing: true })?.kind).toBe("refused");
  });

  it("tells the bot to stop and say what blocks it, in its own words", () => {
    const challenge = pageBlockNote({ kind: "challenge", host: "social.test" });
    expect(challenge).toMatch(/social\.test/);
    expect(challenge).toMatch(/own words/);
    expect(challenge).toMatch(/request_sign_in/);
    const signIn = pageBlockNote({ kind: "sign-in", host: "social.test" });
    expect(signIn).toMatch(/request_login/);
    expect(signIn).toMatch(/request_sign_in/);
  });
});

// The observation script run in a real headless Chrome on local pages that
// refuse the bot, so the flags it reads are the ones a real page gives.
const PAGES: Record<string, { status: number; html: string }> = {
  "/login": { status: 200, html: "<title>Log in to Social</title><h1>Sign in</h1><form><input name=user><input type=password name=pass><button>Log in</button></form>" },
  "/challenge": { status: 403, html: "<title>Just a moment...</title><p>Checking your browser before accessing the site.</p><div class=\"cf-turnstile\" data-sitekey=\"x\"></div>" },
  "/denied": { status: 403, html: "<title>403 Forbidden</title><h1>Access denied</h1>" },
  "/hidden-password": { status: 200, html: "<title>Feed</title><p>Posts</p><input type=password style=\"display:none\">" },
  // Working pages that load a captcha widget the way many sites do: the
  // reCAPTCHA v3 badge iframe (fixed, bottom right), an invisible widget, a
  // Turnstile box in a posting form, and a hidden image challenge frame.
  "/compose-badge": { status: 200, html: "<title>Compose</title><form><textarea name=post></textarea><button>Post</button></form>" +
    "<div class=\"grecaptcha-badge\" style=\"position:fixed;bottom:14px;right:0;width:256px;height:60px\"><iframe title=\"reCAPTCHA\" src=\"/recaptcha/api2/anchor?size=invisible\" width=256 height=60></iframe></div>" },
  "/compose-widgets": { status: 200, html: "<title>Compose</title><form><textarea name=post></textarea><div class=\"g-recaptcha\" data-size=\"invisible\"></div>" +
    "<div class=\"cf-turnstile\" style=\"width:300px;height:65px\"><iframe src=\"/challenges.cloudflare.com/turnstile\" width=300 height=65></iframe></div><button>Post</button></form>" +
    "<div style=\"visibility:hidden;position:absolute;top:-10000px\"><iframe src=\"/recaptcha/api2/bframe\" width=400 height=580></iframe></div>" },
  // A challenge shown to the visitor: the image challenge frame on screen.
  "/image-challenge": { status: 200, html: "<title>Sign up</title><form><input name=user></form><div style=\"position:absolute;top:10px;left:10px\"><iframe src=\"/recaptcha/api2/bframe\" width=400 height=580></iframe></div>" },
};

type Browser = { newPage(): Promise<{ goto(url: string): Promise<unknown>; evaluate(script: string): Promise<unknown> }>; close(): Promise<void> };

describe("pageBlock on real pages (#4394)", () => {
  let server: Server;
  let base = "";
  let browser: Browser | null = null;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const found = PAGES[req.url ?? ""] ?? { status: 404, html: "<title>Not found</title>" };
      res.writeHead(found.status, { "content-type": "text/html" });
      res.end(found.html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ channel: "chrome", headless: true }) as unknown as Browser;
    } catch {
      browser = null;
    }
    // A real Chrome launch under load: the same limit as the repo's other
    // real-browser tests (server/login-fill.e2e.test.ts).
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const observe = async (path: string): Promise<PageState> => {
    const tab = await browser!.newPage();
    await tab.goto(`${base}${path}`);
    const raw = await tab.evaluate(OBSERVE_PAGE_SCRIPT);
    const state = parsePageState({ content: [{ type: "text", text: JSON.stringify(raw) }] });
    expect(state).not.toBeNull();
    return state!;
  };

  it("reads a sign-in wall, a challenge and a refusal from the page itself", async (context) => {
    if (!browser) return context.skip();
    expect(pageBlock(await observe("/login"), { landing: true })?.kind).toBe("sign-in");
    expect(pageBlock(await observe("/challenge"), { landing: true })?.kind).toBe("challenge");
    expect(pageBlock(await observe("/denied"), { landing: true })?.kind).toBe("refused");
    expect(pageBlock(await observe("/hidden-password"), { landing: true })).toBeNull();
    expect(pageBlock(await observe("/image-challenge"), { landing: false })?.kind).toBe("challenge");
  }, 30_000);

  it("leaves working pages that load a captcha badge, an invisible widget or a form widget alone, after an action too", async (context) => {
    if (!browser) return context.skip();
    for (const path of ["/compose-badge", "/compose-widgets"]) {
      const state = await observe(path);
      expect(state.challenge, path).toBeUndefined();
      expect(pageBlock(state, { landing: true }), path).toBeNull();
      expect(pageBlock(state, { landing: false }), path).toBeNull();
    }
  }, 30_000);
});
