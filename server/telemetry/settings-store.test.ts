// OTLP export settings (#2609): sealed at rest, header values write-only.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTelemetrySettingsStore, normalizeEndpoint, TELEMETRY_FILE } from "./settings-store.ts";

const vault = randomBytes(32);
const dirs: string[] = [];
const make = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-telemetry-"));
  dirs.push(dir);
  return { dir, store: createTelemetrySettingsStore(dir, () => ({ kind: "key", key: vault })) };
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("telemetry settings store", () => {
  it("is off with no endpoint", () => {
    const { store } = make();
    expect(store.target()).toBeNull();
    expect(store.view()).toEqual({ endpoint: null, headerNames: [], serviceName: null, enabled: false });
  });

  it("seals the headers, shows only their names, and an empty value keeps the saved one", () => {
    const { dir, store } = make();
    const view = store.save({ endpoint: "https://otel.example.test:4318/", headers: { authorization: "Bearer s3cret-value", "x-team": "ops" }, serviceName: "gox" });
    expect(view).toEqual({ endpoint: "https://otel.example.test:4318", headerNames: ["authorization", "x-team"], serviceName: "gox", enabled: true });
    expect(JSON.stringify(view)).not.toContain("s3cret");
    const file = join(dir, TELEMETRY_FILE);
    expect(readFileSync(file, "utf8")).not.toContain("s3cret");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // A fresh store (restart) reads it back.
    const again = createTelemetrySettingsStore(dir, () => ({ kind: "key", key: vault }));
    expect(again.target()).toEqual({ endpoint: "https://otel.example.test:4318", headers: { authorization: "Bearer s3cret-value", "x-team": "ops" }, serviceName: "gox" });
    // "" keeps authorization; x-team left out goes.
    again.save({ endpoint: "https://otel.example.test:4318", headers: { authorization: "" } });
    expect(again.target()?.headers).toEqual({ authorization: "Bearer s3cret-value" });
    // headers omitted keep them all.
    again.save({ endpoint: "https://other.example.test" });
    expect(again.target()?.headers).toEqual({ authorization: "Bearer s3cret-value" });
    again.remove();
    expect(again.target()).toBeNull();
  });

  it("refuses an address with credentials or a non-http scheme", () => {
    expect(() => normalizeEndpoint("https://user:pw@otel.example.test")).toThrow(/header/);
    expect(() => normalizeEndpoint("ftp://otel.example.test")).toThrow(/http/);
    expect(() => normalizeEndpoint("not a url")).toThrow();
    const { store } = make();
    expect(() => store.save({ endpoint: "https://otel.example.test", headers: { "bad name": "x" } })).toThrow(/header name/);
  });
});
