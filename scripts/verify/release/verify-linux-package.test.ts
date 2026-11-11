import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
/** A repository file as git holds it (LF): a Windows checkout hands it CRLF. */
const readText = (path: string | URL): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("verify-linux-package cloudflared pin", () => {
  it("compares the packaged cloudflared license to the repo LICENSE, which is the Apache 2.0 text", () => {
    const src = readText(new URL("./verify-linux-package.mjs", import.meta.url));
    expect(src).toContain('cloudflared-LICENSE.txt")) !== sha256(path.join(root, "LICENSE"))');
    const license = readText(`${root}/LICENSE`);
    expect(license).toMatch(/Apache License\s+Version 2\.0, January 2004/);
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    const yml = readText(`${root}/electron-builder.yml`);
    expect(yml).toMatch(/- from: LICENSE\n\s+to: licenses\/cloudflared-LICENSE\.txt/);
  });

  it("pins DEB Maintainer to electron-builder.yml, not the upstream author", () => {
    const src = readText(new URL("./verify-linux-package.mjs", import.meta.url));
    const yml = readText(`${root}/electron-builder.yml`);
    const maintainer = yml.match(/^\s*maintainer:\s*(.+)$/m)?.[1]?.trim();
    expect(maintainer).toBeTruthy();
    expect(src).toContain(`Maintainer: ${maintainer}`);
    expect(src).not.toContain("Maintainer: Milind Soni");
  });

  it("pins the Linux desktop Name to electron-builder.yml", () => {
    const src = readText(new URL("./verify-linux-package.mjs", import.meta.url));
    expect(src).toContain('"Name=Pulsatrix Sagax"');
    expect(src).not.toContain('"Name=Sagax"');
  });

  it("points the CI installed-browser smoke at /opt/<productName>/resources", () => {
    const yml = readText(`${root}/electron-builder.yml`);
    const productName = yml.match(/^productName:\s*(.+)$/m)?.[1]?.trim();
    expect(productName).toBeTruthy();
    const ci = readText(`${root}/.github/workflows/ci.yml`);
    expect(ci).toContain(`node scripts/smoke-browser-bundle.mjs --resources "/opt/${productName}/resources"`);
    expect(ci).not.toContain('"/opt/Pulsa Bot/resources"');
  });
});
