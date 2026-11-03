# Media proxy: allowed destinations

The video widget plays some sources through the server:
`GET /api/media/proxy/<token>` (`server/routes/media-widgets.ts`,
`server/media/media-proxy.ts`). The token signs the upstream URL, its expiry and the
thread; HLS playlists are rewritten so their segments, keys and variants go
through the same route. The upstream URL comes from a bot, so the server only
fetches public destinations unless the operator allows more
(`server/media/media-proxy-guard.ts`).

## Refused by default

| Range | Reason in the log |
|---|---|
| `127.0.0.0/8`, `::1`, `localhost`, `*.localhost` | `loopback` |
| `0.0.0.0`, `::` | `unspecified` |
| `169.254.0.0/16`, `fe80::/10` | `link-local` |
| `169.254.169.254`, `168.63.129.16` (Azure WireServer), `fd00:ec2::254` | `metadata` |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | `private` |
| `100.64.0.0/10` (CGNAT, Tailscale) | `cgnat` |
| `fc00::/7` (ULA, Tailscale IPv6) | `ula` |
| `224.0.0.0/4`, `ff00::/8` | `multicast` |
| `0.0.0.0/8`, `240.0.0.0/4`, documentation and benchmark ranges, IPv6 outside `2000::/3`, Teredo, 6to4 | `reserved` |
| `::ffff:0:0/96`, `::/96`, `64:ff9b::/96` (IPv4 inside IPv6) | `ipv4-mapped` |
| a port other than 80 or 443 | `port` |
| a scheme other than http or https | `scheme` |

How the check runs:

- After DNS: every address the name resolves to is checked; one non-public
  answer refuses the name.
- The connection goes to the address that was checked (a `lookup` hook pins
  it), so a second DNS answer cannot move it (DNS rebinding). TLS still
  verifies the certificate against the host name.
- Redirects are followed by the server, at most 5, and each hop is checked
  like the first URL.
- The client gets a generic `403 {"error":"Media source not allowed"}`. The
  reason and the host name go to one server log line
  (`[media-proxy] destination refused: <reason> (host <name>)`), never the
  path, the query or the token.
- The playlist rewrite never turns a URI whose host is a non-public IP literal
  or `localhost` into a proxy path unless it is allowed; URIs on another
  origin stay untouched as before. A host name in a playlist is checked after
  DNS when the proxy fetches it.

Public URLs (YouTube, a public Glitcho such as `qc1.glitcho-server.devjc.net`,
a CDN) need no configuration.

## Allowing a private host

`SAGAX_MEDIA_PROXY_ALLOW_HOSTS` (empty by default) lists the destinations the
proxy may reach anyway, separated by commas or spaces:

- a host name: `glitcho.lan` (exact match);
- a wildcard: `*.tail1234.ts.net` (sub-domains only);
- an IP address or a CIDR: `192.168.1.20`, `192.168.1.0/24`,
  `100.64.0.0/10`, `fd7a:115c:a1e0::/48`.

An allowed host may use any port. A host allowed by name may resolve to a
private address, never to a cloud metadata address; only a CIDR that covers
it explicitly opens that. Example for a Glitcho server on the LAN and the
tailnet:

```
SAGAX_MEDIA_PROXY_ALLOW_HOSTS=glitcho.lan,*.tail1234.ts.net
```

The variable is read from the server's environment (Docker: add it to the
service's `environment`). Changing it applies to the next proxied request.

Tests: `server/media/media-proxy-guard.test.ts`, `server/media/media-proxy.test.ts`,
`server/routes/media-widgets.test.ts`.
