import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseTrivyignore } from "./trivy-ignore-guard.mjs";

const root = join(import.meta.dirname, "..");
// A Windows checkout may hand back CRLF; the patterns below are written for LF.
const read = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

function sandboxChart(file) {
  const helm = join(root, "deploy/k8s/helm");
  const dir = readdirSync(helm).find((name) =>
    readFileSync(join(helm, name, "Chart.yaml"), "utf8").includes("per-person sandboxes"),
  );
  if (!dir) throw new Error("sandbox chart not found");
  return join("deploy/k8s/helm", dir, file);
}

describe("production image sources", () => {
  // The bots' browsers (docs/browser-packaging.md, "Process hygiene"): an
  // init collects the browser processes whose parents exit, and Chrome gets
  // shared memory.
  it("runs every compose service of the server image with an init and Chrome's shared memory", () => {
    for (const file of ["compose.yaml", "deploy/docker-compose.yml", "deploy/podman/compose.yaml"]) {
      const text = read(file);
      expect(text, file).toMatch(/^\s+init: true$/m);
      expect(text, file).toMatch(/^\s+shm_size: 512m$/m);
    }
  });

  // `tailcat ssh` and `tailcat cp` exec the system ssh client with tailcat as
  // its ProxyCommand: without openssh-client in the runtime image every remote
  // session shell, inventory, screenshot and file transfer fails on the server.
  it("ships the ssh client tailcat execs for remote sessions", () => {
    const dockerfile = read("Dockerfile");
    const runtime = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
    expect(runtime).toMatch(/apt-get install -y --no-install-recommends[^\n]*\bopenssh-client\b/);
    expect(runtime).toContain("/usr/local/bin/tailcat");
  });

  it("defaults the image to the full set and exports the build args", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("ARG ENGINE_SET=all");
    expect(dockerfile).not.toContain("ARG ENGINE_SET=none");
    expect(dockerfile).toContain("ARG SAGAX_REQUIRE_ENGINES=1");
    expect(dockerfile).toContain("node:24-trixie-slim@sha256:");
    expect(dockerfile).not.toMatch(/FROM\s+\S*distroless/);
    expect(dockerfile).toContain("apt-get upgrade -y --no-install-recommends");
    expect(dockerfile).toContain("scripts/harden-image-deps.mjs");
    // The server image has Hermes: its pip overlay is never skipped.
    expect(dockerfile).not.toContain("--no-venv");
    expect(dockerfile).toContain("scripts/hermes-python.mjs");
    expect(dockerfile).toContain("install-chrome-for-testing.mjs");
    expect(dockerfile).toContain("libstdc++6");
    expect(dockerfile).not.toMatch(/apt-get install -y --no-install-recommends chromium/);
    expect(read("scripts/harden-image-deps.mjs")).toContain("--require-hashes");
    expect(read("scripts/harden-image-deps.mjs")).toContain("httpx2==2.13.1");
    expect(read("scripts/harden-image-deps.mjs")).toContain("httpcore2==2.13.1");
    expect(dockerfile).toContain("/usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("/opt/yarn-v1.22.22");
    expect(dockerfile).toContain("ENV ENGINE_SET=${ENGINE_SET}");
    expect(dockerfile).toContain('org.opencontainers.image.revision="${SAGAX_COMMIT_SHA}"');
    expect(dockerfile).toContain('org.opencontainers.image.created="${SAGAX_BUILD_TIME}"');
    expect(dockerfile).toContain('io.sagax.engine-set="${SAGAX_ENGINE_SET}"');
    const engineCopy = dockerfile.indexOf("COPY engines.lock.json");
    const label = dockerfile.indexOf("ARG SAGAX_COMMIT_SHA=");
    expect(engineCopy).toBeGreaterThan(0);
    expect(label).toBeGreaterThan(engineCopy);
  });

  it("builds and publishes with ENGINE_SET=all and checks the running container", () => {
    const workflow = read(".github/workflows/docker.yml");
    expect(workflow).toContain("ENGINE_SET=all");
    expect(workflow).toContain("SAGAX_REQUIRE_ENGINES=1");
    expect(workflow).toContain("scripts/engine-image-gate.mjs");
    expect(workflow).toContain("scripts/trivy-ignore-guard.mjs");
    expect(workflow).toContain("scripts/combine-trivyignore.mjs");
    expect(workflow).toContain("scripts/hermes-jwt-overlay-smoke.py");
    expect(read("scripts/hermes-jwt-overlay-smoke.py")).toContain("jwt.encode");
    expect(read("scripts/hermes-jwt-overlay-smoke.py")).toContain("jwt.decode");
    expect(read("scripts/hermes-jwt-overlay-smoke.py")).toContain("algorithm=\"RS256\"");
    expect(read("scripts/hermes-jwt-overlay-smoke.py")).toContain("verify_nas_fire_token");
    expect(read("scripts/hermes-jwt-overlay-smoke.py")).toContain("2.15.1");
    expect(read("scripts/hermes-jwt-overlay-smoke.py")).toContain("hermes-agent");
    expect(workflow).toContain("trivy_0.75.0_Linux-64bit.tar.gz");
    expect(workflow).toContain("--public .trivyignore");
    expect(workflow).toContain("--out /tmp/trivyignore.ci");
    expect(workflow).toContain("--ignorefile /tmp/trivyignore.ci");
    expect(workflow).toContain("--ignorefile /tmp/trivyignore.empty");
    expect(workflow).toContain("secrets.TRIVYIGNORE_PRIVATE");
    expect(workflow).toContain(".trivyignore");
    expect(workflow.split("scripts/combine-trivyignore.mjs").length - 1).toBeGreaterThanOrEqual(3);
    const publicIgnore = parseTrivyignore(read(".trivyignore"));
    expect(publicIgnore.errors).toEqual([]);
    expect(publicIgnore.entries).toHaveLength(34);
    expect(workflow).toContain("--startup-log");
    expect(workflow).toContain("/healthz");
    expect(workflow).toContain("cursor-agent");
    expect(workflow).not.toContain("docker build -t openmausbot:ci .");
    // The Cloud Pro home Dockerfile is not in this tree. A step that builds
    // it fails the job after the engine gate.
    expect(workflow).not.toMatch(/docker build -f deploy\/fly\/Dockerfile/);
    expect(workflow).not.toMatch(/file: deploy\/fly\/Dockerfile/);
  });

  it("publishes both architectures, signs the digest, and attests the scan", () => {
    const workflow = read(".github/workflows/docker.yml");
    const publish = workflow.slice(workflow.indexOf("name: publish to GHCR"));
    expect(publish).toContain("runs-on: ubuntu-latest");
    expect(publish).toContain("id-token: write");
    expect(publish).toContain("packages: write");
    expect(publish).toContain("platforms: linux/amd64,linux/arm64");
    expect(publish).toMatch(/docker\/setup-qemu-action@[0-9a-f]{40}/);
    expect(publish).toMatch(/sigstore\/cosign-installer@[0-9a-f]{40}/);
    expect(publish).toContain("cosign-release: v3.0.6");
    expect(publish).toMatch(/aquasecurity\/setup-trivy@[0-9a-f]{40}/);
    expect(publish).toContain("version: v0.75.0");
    expect(publish).toContain("provenance: mode=max");
    expect(publish).toContain('cosign sign --yes "${STAGING}@${DIGEST}"');
    expect(publish).toContain("cosign attest --yes --type vuln --predicate vuln.json");
    expect(publish).toContain("https://cosign.sigstore.dev/attestation/vuln/v1");
    expect(publish).toContain("https://token.actions.githubusercontent.com");
    expect(publish).toContain(
      "^https://github\\.com/pulsatrixtechnologies/Sagax/\\.github/workflows/docker\\.yml@refs/(heads/main|tags/v.*)$",
    );
    expect(publish).toContain('echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"');
    expect(publish).not.toContain("ghcr.io/${{ github.repository }}");
    expect(publish).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(publish).toContain("node scripts/vuln-attestation.mjs vuln.json vuln-amd64.json vuln-arm64.json");
    expect(publish).toContain("--ignorefile /tmp/trivyignore.ci");
    expect(publish).toContain("scripts/combine-trivyignore.mjs");
    expect(publish).toContain("--platform");
    const values = read(sandboxChart("values.yaml"));
    const admission = values.slice(values.indexOf("admission:"));
    expect(admission).toContain(
      "subjectRegExp: '^https://github\\.com/pulsatrixtechnologies/Sagax/\\.github/workflows/docker\\.yml@refs/(heads/main|tags/v.*)$'",
    );
    expect(admission).not.toContain("pulsatrixtechnologies/sagax");
    const policy = read(sandboxChart("templates/admission.yaml"));
    expect(policy).toContain("subjectRegExp: {{ .Values.admission.kyverno.subjectRegExp | quote }}");
    expect(policy).not.toContain("kyverno.subjects");
    expect(policy).not.toContain("kyverno.subject ");
    // CI runs once, on the release candidate: a tag push or a dispatch.
    expect(workflow).toMatch(/push:\n    tags: \["v\*"\]/);
    expect(workflow).not.toMatch(/^  pull_request:/m);
    expect(workflow).not.toMatch(/refs\/heads\/cursor\//);
    expect(workflow).toContain("sandbox chart values");
    expect(workflow).toContain("sandbox chart templates/admission.yaml");
    const proof = workflow.slice(workflow.indexOf("name: signing proof"));
    expect(proof).toContain(
      "if: github.event_name == 'workflow_dispatch' && github.ref_type == 'branch'",
    );
    expect(proof).toContain('echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/sagax-signing-test" >> "$GITHUB_ENV"');
    expect(proof).toContain("type=raw,value=pr436");
    expect(proof).toContain("platforms: linux/amd64,linux/arm64");
    expect(proof).toContain('cosign sign --yes "${IMAGE}@${DIGEST}"');
    expect(proof).toContain('cosign attest --yes --type vuln --predicate vuln.json "${IMAGE}@${DIGEST}"');
    expect(proof).toContain("cosign verify \\");
    expect(proof).toContain("--certificate-identity");
    expect(proof).toContain("cosign verify-attestation \\");
    expect(proof).toContain("--type vuln \\");
    expect(proof).toContain('docker buildx imagetools inspect "${IMAGE}:pr436"');
    expect(proof).toContain('docker buildx imagetools inspect "${IMAGE}@${DIGEST}"');
    expect(proof).toContain("continue-on-error: true");
    const publishOnly = publish.slice(0, publish.indexOf("name: signing proof"));
    expect(publishOnly).not.toContain("continue-on-error");
    expect(publishOnly).toContain(
      'echo "STAGING=ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/sagax-staging"',
    );
    expect(publishOnly).toContain("name=${{ env.STAGING }}");
    expect(publishOnly).toContain('cosign sign --yes "${STAGING}@${DIGEST}"');
    expect(publishOnly).toContain(
      'cosign attest --yes --type vuln --predicate vuln.json "${STAGING}@${DIGEST}"',
    );
    expect(publishOnly).toContain('cosign copy "${STAGING}@${DIGEST}"');
    const staged = publishOnly.indexOf("name=${{ env.STAGING }}");
    const scanned = publishOnly.indexOf('"${STAGING}@${DIGEST}"');
    const signed = publishOnly.indexOf('cosign sign --yes "${STAGING}@${DIGEST}"');
    const attested = publishOnly.indexOf("cosign attest --yes --type vuln");
    const promoted = publishOnly.indexOf("cosign copy");
    expect(staged).toBeGreaterThan(-1);
    expect(scanned).toBeGreaterThan(staged);
    expect(signed).toBeGreaterThan(scanned);
    expect(attested).toBeGreaterThan(signed);
    expect(promoted).toBeGreaterThan(attested);
    const buildOut = publishOnly.slice(
      publishOnly.indexOf("id: build"),
      publishOnly.indexOf("Scan both platforms"),
    );
    expect(buildOut).not.toContain("env.IMAGE");
  });

  it("forwards the engine set from compose with an empty legacy ENGINES list", () => {
    const compose = read("deploy/docker-compose.yml");
    expect(compose).toContain("ENGINE_SET: ${ENGINE_SET:-all}");
    expect(compose).toContain("SAGAX_REQUIRE_ENGINES: ${SAGAX_REQUIRE_ENGINES:-1}");
    const example = read("deploy/.env.example");
    expect(example).toContain("ENGINES=");
    expect(example).not.toContain("ENGINES=@anthropic-ai/claude-code");
    const build = read("scripts/build-production-image.sh");
    expect(build).toContain("--build-arg ENGINE_SET=all");
    expect(build).toContain("--build-arg SAGAX_REQUIRE_ENGINES=1");
  });
});
