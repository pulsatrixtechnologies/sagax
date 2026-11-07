import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { feedbackConfigView, readFeedbackConfig, writeFeedbackConfig } from "./config.ts";

const dirs: string[] = [];
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), "fb-config-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("feedback filing config (#2618)", () => {
  it("defaults to the product repository with no token", () => {
    const config = readFeedbackConfig(fresh(), {});
    expect(config.repo).toBe("pulsatrixtechnologies/sagax");
    expect(config.token).toBeUndefined();
    expect(feedbackConfigView(config)).toEqual({ repo: "pulsatrixtechnologies/sagax", tokenSet: false, source: null });
  });

  it("keeps the token in a private file and never shows it back", () => {
    const dir = fresh();
    writeFeedbackConfig(dir, { repo: "acme/app", token: "ghp_example_not_real_000000000000000000" });
    const config = readFeedbackConfig(dir, {});
    expect(config.token).toBe("ghp_example_not_real_000000000000000000");
    expect(statSync(join(dir, "feedback", "config.json")).mode & 0o777).toBe(0o600);
    const view = feedbackConfigView(config);
    expect(view).toEqual({ repo: "acme/app", tokenSet: true, source: "file" });
    expect(JSON.stringify(view)).not.toContain("ghp_");
    writeFeedbackConfig(dir, { token: null });
    expect(readFeedbackConfig(dir, {}).token).toBeUndefined();
    expect(readFeedbackConfig(dir, {}).repo).toBe("acme/app");
  });

  it("takes the environment token over the file, and refuses a malformed repo", () => {
    const dir = fresh();
    expect(readFeedbackConfig(dir, { SAGAX_FEEDBACK_GITHUB_TOKEN: "env-token" }).token).toBe("env-token");
    expect(feedbackConfigView(readFeedbackConfig(dir, { SAGAX_FEEDBACK_GITHUB_TOKEN: "env-token" })).source).toBe("env");
    expect(() => writeFeedbackConfig(dir, { repo: "not a repo" })).toThrow();
  });
});
