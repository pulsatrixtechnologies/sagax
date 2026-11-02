import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { npmInstallHints, rebrandFile } from "./rebrand-upstream.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The old name, assembled as the script does so that it never rewrites this file.
const OLD = ["open", "maus", "bot"].join("");
const Old = ["Open", "Maus", "Bot"].join("");
const UPSTREAM = ["milind", "soni"].join("-");

describe("rebrand-upstream narrow rules", () => {
  it("points the deploy image at the local build, and keeps the upstream releases repository", () => {
    const compose = `    image: ghcr.io/${UPSTREAM}/${OLD}:latest\n`;
    expect(rebrandFile("deploy/docker-compose.yml", compose)).toBe("    image: sagax:local\n");
    const workflow = `docker tag ${OLD}:ci ghcr.io/${UPSTREAM}/${OLD}:latest\n`;
    expect(rebrandFile(".github/workflows/docker.yml", workflow)).toBe(`docker tag ${OLD}:ci sagax:local\n`);
    const releases = `https://github.com/${UPSTREAM}/${OLD}-releases\n`;
    expect(rebrandFile("docs/releasing.md", releases)).toBe(releases);
  });

  it("names the product in the native copy files, keeping credit and resource names", () => {
    const strings = `<string name="mobile_send_to_${OLD}">Send to ${Old}</string>\n<string name="x">That is not an ${Old} pairing QR code.</string>\n`;
    expect(rebrandFile("android/app/src/main/res/values-fr/strings.xml", strings)).toBe(
      `<string name="mobile_send_to_${OLD}">Send to Sagax</string>\n<string name="x">That is not a Sagax pairing QR code.</string>\n`,
    );
    expect(rebrandFile("ios/AppStore/en-US/description.txt", `Requires ${Old}.\nBased on ${Old} 1.0.\n`)).toBe(`Requires Sagax.\nBased on ${Old} 1.0.\n`);
    // other native sources keep their own pace
    const kotlin = `val copy = "Keep ${Old} open"\n`;
    expect(rebrandFile("android/app/src/main/kotlin/x/SharePolicy.kt", kotlin)).toBe(kotlin);
  });

  it("renames the Android signing variables and keeps the documented fallback", () => {
    const UP = OLD.toUpperCase();
    const gradle = `signingMaterial("storeFile", "${UP}_KEYSTORE_FILE")\nsigningMaterial("keyAlias", "SAGAX_KEY_ALIAS", "${UP}_KEY_ALIAS")\n`;
    expect(rebrandFile("android/app/build.gradle.kts", gradle)).toBe(
      `signingMaterial("storeFile", "SAGAX_KEYSTORE_FILE")\nsigningMaterial("keyAlias", "SAGAX_KEY_ALIAS", "${UP}_KEY_ALIAS")\n`,
    );
  });

  it("reports npm install hints in docs without rewriting them", () => {
    const doc = `run this:\nnpx ${OLD} serve\nnpm install --global --prefix "$HOME/opt" ${OLD}@X.Y.Z\n`;
    expect(npmInstallHints("docs/self-hosting.md", doc)).toEqual([
      [2, `npx ${OLD}`],
      [3, `npm install --global --prefix "$HOME/opt" ${OLD}`],
    ]);
    expect(rebrandFile("docs/self-hosting.md", doc)).toBe(doc);
    expect(npmInstallHints("docs/verification/run-2026-09-07.md", doc)).toEqual([]);
    expect(npmInstallHints("server/cli.ts", doc)).toEqual([]);
  });

  it("keeps the upstream credit in every language", () => {
    const locales = {
      "src/locales/en.json": `  "about.basedOn": "Based on ${Old} {version}",\n`,
      "src/locales/fr.json": `  "about.basedOn": "Basé sur ${Old} {version}",\n`,
      "src/locales/es.json": `  "about.basedOn": "Basado en ${Old} {version}",\n`,
      "src/locales/pt-br.json": `  "about.basedOn": "Baseado em ${Old} {version}",\n`,
      "src/locales/de.json": `  "about.basedOn": "Basiert auf ${Old} {version}",\n`,
      "src/locales/zh.json": `  "about.basedOn": "基于 ${Old} {version}",\n`,
      "src/locales/zh-tw.json": `  "about.basedOn": "基於 ${Old} {version}",\n`,
      "src/locales/ja.json": `  "about.basedOn": "${Old} をベースに {version}",\n`,
    };
    for (const [file, line] of Object.entries(locales)) expect(rebrandFile(file, line)).toBe(line);
    const fr = `<string name="about_based_on">Basé sur ${Old}</string>\n`;
    expect(rebrandFile("android/app/src/main/res/values-fr/strings.xml", fr)).toBe(fr);
    const test = `    expect(fr).toContain("Basé sur ${Old}");\n`;
    expect(rebrandFile("src/components/windows-style.test.ts", test)).toBe(test);
  });

  it("keeps the license credit in the README and CONTRIBUTING, line breaks included", () => {
    const readme = `[NOTICE](NOTICE) and [\`third_party/\`](third_party/). ${Old} and MausBot\nare trademarks of their owner and are not this product's name.\n`;
    expect(rebrandFile("README.md", readme)).toBe(readme);
    const contributing = `  [Apache License 2.0](LICENSE). Parts that come unchanged from\n  ${Old} keep their notices.\n`;
    expect(rebrandFile("CONTRIBUTING.md", contributing)).toBe(contributing);
  });

  it("keeps upstream pull requests and releases named as a port's source", () => {
    const refs = [
      `// Port of ${Old} #3009, rewritten for this project\n`,
      `  // A browser is never the owner here (${Old}\n  // #2930 port).\n`,
      ` * the item came from (port de ${Old} #3017). */\n`,
      `* **${Old} 0.1.95 sync**: pinned threads\n`,
      ` * unambiguous, else double-quoted (from ${Old}, used by the importer)\n`,
      `if (/^(?:Sagax|${Old})\\/[\\d.]+/i.test(ua)) return "app";\n`,
      `    expect(out.text).not.toContain("${Old}");\n`,
    ];
    for (const text of refs) expect(rebrandFile("server/x.ts", text)).toBe(text);
    // the product name itself still changes
    expect(rebrandFile("server/x.ts", `// ${Old} serves the UI\n`)).toBe("// Sagax serves the UI\n");
  });

  it("leaves every credit line of the tracked legal and credit files as it is", () => {
    const files = execFileSync("git", ["ls-files", "README.md", "CONTRIBUTING.md", "LICENSING.md", "CLA.md", "src/locales/*.json"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter((file) => file && !file.endsWith("source-hashes.json"));
    expect(files.length).toBeGreaterThan(4);
    let creditLines = 0;
    for (const file of files) {
      const before = readFileSync(join(ROOT, file), "utf8").split("\n");
      const after = rebrandFile(file, before.join("\n")).split("\n");
      before.forEach((line, index) => {
        if (!line.includes(Old)) return;
        creditLines += 1;
        expect(`${file}:${index + 1}: ${after[index]}`).toBe(`${file}:${index + 1}: ${line}`);
      });
    }
    expect(creditLines).toBeGreaterThan(0);
  });
});
