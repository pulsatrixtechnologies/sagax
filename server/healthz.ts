import { HEALTH_IDENTITY } from "../electron/legacy-names.mjs";

/** `GET /healthz` for deploy probes and `docker exec`. Registered before
 * the SPA fallback: a path with no file is index.html. Loopback has a
 * session, so this must not wait on `!gate.auth` the way the public
 * `/api/health` stranger probe does.
 *
 * During graceful shutdown (`isShuttingDown`), callers should answer 503
 * instead of this body so Caddy / k8s stop routing while in-flight work
 * drains (docs/zero-downtime-deploy.md). */
export function healthzBody(): { ok: true; app: string; product: string } {
  return { ok: true, ...HEALTH_IDENTITY };
}

/** Body for an unready probe during shutdown. */
export function healthzUnreadyBody(): { ok: false; app: string; product: string; shuttingDown: true } {
  return { ok: false, shuttingDown: true, ...HEALTH_IDENTITY };
}
