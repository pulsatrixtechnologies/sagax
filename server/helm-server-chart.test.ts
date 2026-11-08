import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "deploy", "k8s", "helm", "server");
const text = (file: string) => readFileSync(join(root, file), "utf8");

describe("sagax server chart", () => {
  it("is a server chart that the repo does not apply", () => {
    const chart = text("Chart.yaml");
    expect(chart).toContain("name: sagax-server");
    expect(chart).toContain("Nothing in this repo applies it");
    const readme = text("README.md");
    expect(readme).toContain("No workflow applies it");
    expect(readme.toLowerCase()).not.toContain("acme");
    const rendered = ["templates/deployment.yaml", "templates/service.yaml", "templates/configmap.yaml", "values.yaml"]
      .map(text).join("\n");
    expect(rendered).not.toMatch(/\bhelm upgrade\b|\bkubectl apply\b/);
    expect(rendered).toContain("ghcr.io/pulsatrixtechnologies/sagax");
    expect(rendered).toContain("127.0.0.1:8799");
    expect(rendered).toContain("containerPort: 8799");
  });
});
