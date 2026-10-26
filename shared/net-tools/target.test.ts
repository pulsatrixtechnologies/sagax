import { describe, expect, it } from "vitest";

import { isIpv4Literal, isIpv6Literal, isRefusedName, parseNetTarget } from "./target.ts";

describe("net-tools target parsing", () => {
  it("accepts names, lower-cases them and drops a trailing dot", () => {
    expect(parseNetTarget(" Example.COM. ")).toEqual({ ok: true, target: { kind: "domain", host: "example.com" } });
    expect(parseNetTarget("mail.sub.example.org")).toEqual({ ok: true, target: { kind: "domain", host: "mail.sub.example.org" } });
  });

  it("converts IDN names to ASCII", () => {
    expect(parseNetTarget("bücher.example")).toEqual({ ok: true, target: { kind: "domain", host: "xn--bcher-kva.example" } });
    expect(parseNetTarget("café.example.com")).toEqual({ ok: true, target: { kind: "domain", host: "xn--caf-dma.example.com" } });
  });

  it("accepts IPv4 and IPv6 literals, and normalises IPv6", () => {
    expect(parseNetTarget("192.0.2.1")).toEqual({ ok: true, target: { kind: "ipv4", host: "192.0.2.1" } });
    expect(parseNetTarget("2001:DB8:0:0::1")).toEqual({ ok: true, target: { kind: "ipv6", host: "2001:db8::1" } });
    expect(parseNetTarget("[2001:db8::1]")).toEqual({ ok: true, target: { kind: "ipv6", host: "2001:db8::1" } });
    expect(isIpv4Literal("256.1.1.1")).toBe(false);
    expect(isIpv4Literal("01.1.1.1")).toBe(false);
    expect(isIpv6Literal("::ffff:127.0.0.1")).toBe(true);
    expect(isIpv6Literal("example.com")).toBe(false);
  });

  it("refuses internal, local and single-label names", () => {
    for (const name of ["localhost", "db.localhost", "printer.local", "metadata.google.internal", "nas.home.arpa", "router.lan", "intranet", "LOCALHOST."]) {
      expect(parseNetTarget(name), name).toEqual({ ok: false, code: "target.refused_name" });
    }
    expect(isRefusedName("example.com")).toBe(false);
  });

  it("refuses the server's own public names", () => {
    const ownNames = ["sagax.example.net"];
    expect(parseNetTarget("sagax.example.net", { ownNames })).toEqual({ ok: false, code: "target.refused_name" });
    expect(parseNetTarget("api.sagax.example.net", { ownNames })).toEqual({ ok: false, code: "target.refused_name" });
    expect(parseNetTarget("other.example.net", { ownNames }).ok).toBe(true);
  });

  it("refuses what is not a name", () => {
    for (const bad of ["exa mple.com", "-bad.example.com", "bad-.example.com", "a..example.com", "example.com/path", "user@example.com", "1.2.3", "192.0.2.300", "_dmarc.example.com"]) {
      expect(parseNetTarget(bad), bad).toEqual({ ok: false, code: "target.invalid" });
    }
    expect(parseNetTarget("")).toEqual({ ok: false, code: "target.empty" });
    expect(parseNetTarget("   ")).toEqual({ ok: false, code: "target.empty" });
    expect(parseNetTarget(42)).toEqual({ ok: false, code: "target.empty" });
  });

  it("caps names at 253 characters and labels at 63", () => {
    const label = "a".repeat(63);
    const long = [label, label, label, `${"b".repeat(57)}.com`].join(".");
    expect(long.length).toBe(253);
    expect(parseNetTarget(long).ok).toBe(true);
    expect(parseNetTarget(`c${long}`)).toEqual({ ok: false, code: "target.too_long" });
    expect(parseNetTarget(`${"a".repeat(64)}.example.com`)).toEqual({ ok: false, code: "target.invalid" });
  });

  it("allows service labels only when asked (DNS lookups)", () => {
    expect(parseNetTarget("_dmarc.example.com", { underscoreLabels: true })).toEqual({ ok: true, target: { kind: "domain", host: "_dmarc.example.com" } });
    expect(parseNetTarget("selector1._domainkey.example.com", { underscoreLabels: true }).ok).toBe(true);
  });

  it("takes a name only when asked for a domain", () => {
    expect(parseNetTarget("192.0.2.1", { accept: "domain" })).toEqual({ ok: false, code: "target.invalid" });
    expect(parseNetTarget("2001:db8::1", { accept: "domain" })).toEqual({ ok: false, code: "target.invalid" });
  });

  it("reads host:port and [v6]:port", () => {
    expect(parseNetTarget("example.com:8443", { accept: "host_port" })).toEqual({ ok: true, target: { kind: "domain", host: "example.com", port: 8443 } });
    expect(parseNetTarget("[2001:db8::1]:443", { accept: "host_port" })).toEqual({ ok: true, target: { kind: "ipv6", host: "2001:db8::1", port: 443 } });
    expect(parseNetTarget("2001:db8::1", { accept: "host_port" })).toEqual({ ok: true, target: { kind: "ipv6", host: "2001:db8::1" } });
    expect(parseNetTarget("example.com", { accept: "host_port" })).toEqual({ ok: true, target: { kind: "domain", host: "example.com" } });
    for (const bad of ["example.com:0", "example.com:65536", "example.com:http", "example.com:"]) {
      expect(parseNetTarget(bad, { accept: "host_port" }), bad).toEqual({ ok: false, code: "target.bad_port" });
    }
    expect(parseNetTarget("localhost:22", { accept: "host_port" })).toEqual({ ok: false, code: "target.refused_name" });
  });

  it("reads http(s) URLs without credentials", () => {
    expect(parseNetTarget("example.com", { accept: "url" })).toEqual({ ok: true, target: { kind: "domain", host: "example.com", url: "https://example.com/" } });
    expect(parseNetTarget("http://Example.com:8080/a?b=1#frag", { accept: "url" })).toEqual({ ok: true, target: { kind: "domain", host: "example.com", port: 8080, url: "http://example.com:8080/a?b=1" } });
    expect(parseNetTarget("https://[2001:db8::1]/", { accept: "url" })).toEqual({ ok: true, target: { kind: "ipv6", host: "2001:db8::1", url: "https://[2001:db8::1]/" } });
    expect(parseNetTarget("ftp://example.com/", { accept: "url" })).toEqual({ ok: false, code: "target.bad_url" });
    expect(parseNetTarget("file:///etc/passwd", { accept: "url" })).toEqual({ ok: false, code: "target.bad_url" });
    expect(parseNetTarget("https://user:pass@example.com/", { accept: "url" })).toEqual({ ok: false, code: "target.url_credentials" });
    expect(parseNetTarget("http://localhost:3000/", { accept: "url" })).toEqual({ ok: false, code: "target.refused_name" });
    expect(parseNetTarget("https://intranet/", { accept: "url" })).toEqual({ ok: false, code: "target.refused_name" });
  });

  it("leaves address checks to the server guard", () => {
    // syntax only: a private literal parses here and is refused by server/net-tools/guard.ts
    expect(parseNetTarget("10.0.0.1").ok).toBe(true);
    expect(parseNetTarget("http://127.0.0.1/", { accept: "url" }).ok).toBe(true);
  });
});
