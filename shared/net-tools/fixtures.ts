// IT tools: sample results for tests and, later, the gallery page. Targets
// are reserved example names (RFC 2606) and documentation addresses
// (RFC 5737, RFC 3849); list names are made up. Each check has at least one
// result, and between them they cover every verdict.
import { netOverallVerdict, type NetCheckResult, type NetFinding } from "./types.ts";

/** 2026-10-21 14:32 UTC */
export const NET_FIXTURE_AT = Date.UTC(2026, 9, 21, 14, 32);

function result(partial: Omit<NetCheckResult, "at" | "durationMs" | "verdict" | "vantage" | "details" | "raw"> & Partial<Pick<NetCheckResult, "details" | "raw" | "durationMs">>): NetCheckResult {
  return { at: NET_FIXTURE_AT, durationMs: 412, details: [], raw: "", ...partial, verdict: netOverallVerdict(partial.findings), vantage: "server" };
}

const spfRecord = "v=spf1 include:_spf.mail.example.net include:sender.example.org ip4:192.0.2.0/24 ~all";

export const NET_FIXTURES: Record<string, NetCheckResult> = {
  dnsPass: result({
    check: "dns_lookup",
    target: "example.com",
    findings: [{ code: "dns.records_found", severity: "pass", params: { count: 5 } }, { code: "dns.dnssec_validated", severity: "info" }],
    details: [
      { label: "A", columns: ["value", "ttl"], rows: [["192.0.2.10", "300"]] },
      { label: "AAAA", columns: ["value", "ttl"], rows: [["2001:db8::10", "300"]] },
      { label: "NS", columns: ["value", "ttl"], rows: [["ns1.example.net", "86400"], ["ns2.example.net", "86400"]] },
      { label: "TXT", columns: ["value", "ttl"], rows: [[spfRecord, "3600"]] },
    ],
    raw: "example.com. 300 IN A 192.0.2.10\nexample.com. 300 IN AAAA 2001:db8::10\nexample.com. 86400 IN NS ns1.example.net.\nexample.com. 86400 IN NS ns2.example.net.",
  }),
  dnsFail: result({
    check: "dns_lookup",
    target: "missing.example.com",
    findings: [{ code: "dns.nxdomain", severity: "fail", params: { name: "missing.example.com" } }],
    raw: ";; status: NXDOMAIN",
  }),
  mxWarn: result({
    check: "mx_lookup",
    target: "example.org",
    findings: [
      { code: "mx.ok", severity: "pass", params: { count: 2 } },
      { code: "mx.ptr_not_confirmed", severity: "warn", params: { ip: "198.51.100.25", ptr: "host25.example.net" } },
      { code: "mx.cname", severity: "warn", params: { host: "mx2.example.org" } },
    ],
    details: [{
      label: "mx_hosts",
      columns: ["priority", "host", "ips", "ptr"],
      rows: [["10", "mx1.example.org", "198.51.100.24", "mx1.example.org"], ["20", "mx2.example.org", "198.51.100.25", "host25.example.net"]],
    }],
  }),
  mxNull: result({
    check: "mx_lookup",
    target: "example.net",
    findings: [{ code: "mx.null", severity: "info" }],
    details: [{ label: "mx_hosts", columns: ["priority", "host"], rows: [["0", "."]] }],
  }),
  mailAuthWarn: result({
    check: "mail_auth_check",
    target: "example.com",
    findings: [
      { code: "spf.softfail_all", severity: "warn" },
      { code: "spf.too_many_lookups", severity: "fail", params: { count: 12 } },
      { code: "dkim.weak_key", severity: "warn", params: { bits: 1024 } },
      { code: "dmarc.policy_none", severity: "warn" },
      { code: "dmarc.no_rua", severity: "info" },
    ],
    details: [
      { label: "spf", columns: ["value"], rows: [[spfRecord]] },
      { label: "dkim", columns: ["field", "value"], rows: [["selector1", "k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1"]] },
      { label: "dmarc", columns: ["value"], rows: [["v=DMARC1; p=none"]] },
    ],
    raw: `example.com TXT "${spfRecord}"\n_dmarc.example.com TXT "v=DMARC1; p=none"`,
  }),
  mailAuthPass: result({
    check: "mail_auth_check",
    target: "example.org",
    findings: [
      { code: "spf.ok", severity: "pass" },
      { code: "dkim.ok", severity: "pass", params: { selector: "s1", bits: 2048 } },
      { code: "dmarc.policy_reject", severity: "pass" },
    ],
  }),
  blacklistFail: result({
    check: "blacklist_check",
    target: "192.0.2.44",
    findings: [
      { code: "dnsbl.listed", severity: "fail", params: { zone: "major.dnsbl.example", ip: "192.0.2.44" } },
      { code: "dnsbl.refused", severity: "unknown", params: { zone: "strict.dnsbl.example" } },
    ],
    details: [{
      label: "zones",
      columns: ["zone", "status", "reason"],
      rows: [["major.dnsbl.example", "listed", "Spam source"], ["minor.dnsbl.example", "clean", ""], ["strict.dnsbl.example", "unknown", "query refused"]],
    }],
    links: [{ label: "Delist: major.dnsbl.example", url: "https://major.dnsbl.example/lookup?ip=192.0.2.44" }],
  }),
  blacklistUnknown: result({
    check: "blacklist_check",
    target: "2001:db8::25",
    findings: [{ code: "dnsbl.ipv6_skipped", severity: "info" }, { code: "dnsbl.unknown", severity: "unknown", params: { zone: "slow.dnsbl.example" } }],
  }),
  tlsFail: result({
    check: "tls_check",
    target: "expired.example.com:443",
    findings: [
      { code: "tls.expired", severity: "fail", params: { date: "2026-09-30" } },
      { code: "tls.incomplete_chain", severity: "fail" },
      { code: "tls.sha1", severity: "warn" },
    ],
    details: [
      { label: "chain", columns: ["subject", "issuer", "valid_until"], rows: [["CN=expired.example.com", "CN=Example Intermediate CA", "2026-09-30"]] },
      { label: "connection", columns: ["field", "value"], rows: [["Protocol", "TLSv1.3"], ["Cipher", "TLS_AES_256_GCM_SHA384"]] },
    ],
  }),
  tlsPass: result({
    check: "tls_check",
    target: "example.com",
    findings: [{ code: "tls.ok", severity: "pass", params: { days: 74 } }],
  }),
  domainWarn: result({
    check: "domain_info",
    target: "example.com",
    findings: [
      { code: "rdap.expires_30", severity: "warn", params: { days: 21, date: "2026-11-11" } },
      { code: "rdap.no_transfer_lock", severity: "info" },
      { code: "rdap.dnssec_unsigned", severity: "info" },
    ],
    details: [
      { label: "registration", columns: ["field", "value"], rows: [["Registrar", "Example Registrar"], ["Created", "1995-08-14"], ["Expires", "2026-11-11"]] },
      { label: "nameservers", columns: ["host"], rows: [["ns1.example.net"], ["ns2.example.net"]] },
    ],
  }),
  domainUnknown: result({
    check: "domain_info",
    target: "example.invalid",
    findings: [{ code: "rdap.no_service", severity: "unknown", params: { tld: "invalid" } }],
  }),
  httpWarn: result({
    check: "http_headers",
    target: "http://example.com/",
    findings: [
      { code: "http.hsts_missing", severity: "warn" },
      { code: "http.csp_missing", severity: "warn" },
      { code: "http.version_disclosure", severity: "info", params: { header: "Server", value: "ExampleServer/2.4.1" } },
      { code: "http.insecure_cookie", severity: "warn", params: { cookie: "session", flags: "Secure, SameSite" } },
    ],
    details: [
      { label: "redirects", columns: ["status", "url"], rows: [["301", "http://example.com/"], ["200", "https://example.com/"]] },
      { label: "headers", columns: ["header", "value"], rows: [["server", "ExampleServer/2.4.1"], ["x-frame-options", "SAMEORIGIN"]] },
    ],
  }),
  headersFail: result({
    check: "email_header_analyze",
    target: "pasted headers",
    findings: [
      { code: "hdr.dmarc_fail", severity: "fail", params: { result: "fail", domain: "example.com" } },
      { code: "hdr.reply_to_differs", severity: "warn", params: { domain: "example.net" } },
      { code: "hdr.hop_delay", severity: "warn", params: { hop: 2, minutes: 14 } },
      { code: "hdr.dkim_not_reverified", severity: "info" },
    ],
    details: [{ label: "hops", columns: ["from", "by", "when", "delay"], rows: [["mail.example.net", "mx1.example.org", "14:01", "0 s"], ["mx1.example.org", "inbound.example.org", "14:15", "14 min"]] }],
  }),
  propagationInfo: result({
    check: "dns_propagation",
    target: "www.example.com",
    findings: [{ code: "dns.records_found", severity: "pass", params: { count: 4 } }],
    details: [{ label: "records", columns: ["resolver", "answer", "ttl"], rows: [["ns1.example.net", "192.0.2.10", "300"], ["resolver A", "192.0.2.10", "211"]] }],
  }),
  portsError: result({
    check: "port_check",
    target: "example.com",
    findings: [{ code: "check.no_egress", severity: "unknown" }],
  }),
  pingTimeout: result({
    check: "tcp_ping",
    target: "example.com:443",
    findings: [{ code: "check.timeout", severity: "unknown", params: { seconds: 20 } }],
  }),
  empty: result({ check: "dns_lookup", target: "example.com", findings: [] }),
};

/** A result past every card limit: many findings, wide and long tables,
 * long cells, a raw output at the result cap with backtick runs in it. */
export function netStressFixture(): NetCheckResult {
  const findings: NetFinding[] = Array.from({ length: 30 }, (_unused, index) => ({
    code: index % 3 === 0 ? "spf.unknown_mechanism" : index % 3 === 1 ? "dnsbl.listed_minor" : "dns.lame_ns",
    severity: index % 3 === 0 ? "fail" : index % 3 === 1 ? "warn" : "info",
    params: { mechanism: `x${index}`, zone: `list${index}.dnsbl.example`, ip: "192.0.2.1", ns: `ns${index}.example.net` },
  }));
  const wide = Array.from({ length: 10 }, (_unused, column) => `column ${column}`);
  const rows = (count: number, length: number) => Array.from({ length: count }, (_unused, row) => Array.from({ length: 10 }, (_unused2, column) => `r${row}c${column} ${"v".repeat(length)}`));
  return result({
    check: "blacklist_check",
    target: `${"a".repeat(60)}.${"b".repeat(60)}.example.com`,
    findings,
    details: [
      { label: "zones", columns: wide, rows: rows(80, 300) },
      { label: "TXT", rows: rows(70, 40) },
      { label: "records", columns: ["value"], rows: [] },
    ],
    raw: `${"```\n".repeat(10)}${"raw line with data\n".repeat(900)}`.slice(0, 16_000),
    links: Array.from({ length: 10 }, (_unused, index) => ({ label: `Delist ${index % 8}`, url: `https://list${index}.dnsbl.example/delist` })),
  });
}
