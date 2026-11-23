import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.github/workflows/release.yml"),
  "utf8",
);

function notarizeStep() {
  const start = workflow.indexOf("name: Notarize all four artifacts");
  const end = workflow.indexOf("name: Staple, re-zip, regenerate blockmaps and the feed");
  return workflow.slice(start, end);
}

describe("macOS notarize step", () => {
  it("prints notarytool's output and exit code when Apple refuses the request", () => {
    const step = notarizeStep();
    expect(step).toContain("|| rc=$?");
    expect(step).toContain("notarytool exit code");
    expect(step).toContain('trap \'rm -f "$RUNNER_TEMP/notary.p8"\' EXIT');
    expect(step).not.toContain("out=$(xcrun notarytool submit");
  });
});
