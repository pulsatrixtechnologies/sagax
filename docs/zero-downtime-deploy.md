# Invisible deploys (zero downtime for people)

A Sagax restart used to show people errors: the process stopped accepting,
Caddy answered 502, and clients toasted a failure. Deploys should stay
invisible for a short restart (under about 30 seconds).

Three layers work together.

## 1. Server graceful shutdown

On `SIGTERM` / `SIGINT` (`server/graceful-shutdown.ts`, wired in
`server/index.ts`):

1. Mark probes unready (`markShuttingDown`): `/healthz` and `/api/health`
   answer **503** so the edge stops routing.
2. Close live SSE streams. Clients reconnect with their cursor
   (`?since=` / `Last-Event-ID`); the edge holds those reconnects.
3. Drain in-flight turns for a bounded time
   (`SAGAX_SHUTDOWN_DRAIN_MS`, default 5 s on a server, 0 under the
   desktop app).
4. Stop accepting and finish in-flight HTTP
   (`server/http-shutdown.ts`), then flush durable state (bus, sessions,
   ledgers) and exit.

Runtime state is already durable on disk. Interrupted turns resume once
at the next start (`server/interrupted-turns.ts`).

Raise `SAGAX_SHUTDOWN_DRAIN_MS` together with the container stop grace
period (Compose `stop_grace_period`, k8s `terminationGracePeriodSeconds`)
when turns need longer to land.

## 2. Caddy holds requests during the restart

Every Caddyfile we ship (`deploy/Caddyfile`, `install.sh`,
`server/caddy.ts`, `server/fleet.ts`, helm configmap, local/podman)
configures the reverse proxy to **wait** instead of 502 while the single
upstream is gone:

- `lb_try_duration 25s` / `lb_try_interval 250ms`
- passive: `fail_duration 10s`, `unhealthy_status 502 503`
- active: `health_uri /healthz`, `health_interval 2s`, `health_timeout 1s`
- app path keeps `flush_interval -1` for SSE

Caddy retries selecting a healthy upstream for that window. People see a
pause, not an error page.

## 3. Clients stay calm and resume the stream

Desktop / web (`src/`):

- Live events already reconnect with backoff and the cursor
  (`src/lib/live-events.ts`).
- While the stream is down for under 30 s after a live session, the UI
  shows **Reconnecting…** (`ChatReconnectBanner`) and suppresses error
  toasts for 502/503/connection refused (`src/lib/deploy-reconnect.ts`).

iOS (`ios/`):

- Stream resume from cursor is unchanged (`Client.events(since:)`,
  `Session`).
- Gateway 502/503/504 without another route show **Reconnecting…**
  (`ConnectionAdvice`); the status banner stays calm.

Companion sidecar:

- `ECONNREFUSED` / `ECONNRESET` to the harness answer **503** with a
  reconnecting message so the phone retries instead of toasting a hard
  failure.

## Deploy procedures

### Single VM (Docker / install.sh / `serve --domain`)

Caddy hold is the path. Typical update:

```sh
# Docker helper written by install.sh
sagax update

# or Compose
docker compose pull && docker compose up -d
```

The old process gets `SIGTERM`, drains, exits. Caddy holds new requests
until `/healthz` is 200 again. Do not publish the app port without Caddy
in front.

### AKS / Kubernetes (helm chart under `deploy/k8s/helm/server`)

- Readiness probe: `GET /api/health` on the app port (already in the
  chart). During shutdown it returns 503 so the pod leaves the Service
  endpoints before exit.
- `terminationGracePeriodSeconds: 40` covers drain + cleanup.
- Strategy:
  - **replicas > 1**: `RollingUpdate` with `maxUnavailable: 0` (new pod
    ready before an old one is removed).
  - **replicas = 1** with a ReadWriteOnce PVC: `Recreate` (two pods cannot
    share that volume). Rely on Caddy's hold inside the pod (edge
    container) for the brief gap, same as a single VM.

Set `replicas` in values when the data volume and architecture allow more
than one server process. This chart never applies itself; operators apply
a rendered manifest.

### What not to do

- Do not run deploy scripts against live hosts from an agent session
  without an explicit operator GO.
- Do not skip Caddy (or an equivalent hold) in front of a public URL.
- Do not lower `terminationGracePeriodSeconds` below the drain + cleanup
  budget.

## Tests

- `server/http-shutdown.test.ts`, `server/graceful-shutdown.test.ts`,
  `server/healthz.test.ts`
- `server/caddy.test.ts`, `server/fleet.test.ts`
- `src/lib/deploy-reconnect.test.ts`, `src/components/ChatErrorBanner.test.ts`
- `companion/test/upstream-failure.test.ts`
- iOS: `FailoverTests.testDeployOutageShowsCalmReconnectingWithoutAnotherRoute`
