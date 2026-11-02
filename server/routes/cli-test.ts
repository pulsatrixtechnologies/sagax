// CLI binary discovery for the Engines "detected" dropdown, and a pre-save
// probe that the path actually runs.
//
//   GET  /api/cli-candidates   ?name=claude → absolute paths on PATH
//   POST /api/cli-test         { cli, driver } → spawn `<cli> --version`
import { BUILT_IN_DRIVERS } from "../drivers/builtIn.ts";
import { findCliCandidates, resetPathCache } from "../env-path.ts";
import { HOSTED_PROVIDER_SETTINGS_ERROR } from "../hosted-models.ts";
import { cliCommandRefusal } from "../procs.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type CliTestProbe = {
  ok: boolean;
  version?: string;
  message?: string;
  install?: (typeof BUILT_IN_DRIVERS)[number]["install"];
};

export interface CliTestRouteDeps {
  /** Hosted team workspace: engines are managed in Admin. */
  hostedModels: boolean;
  testCliBinary: (
    cli: string,
    driver: (typeof BUILT_IN_DRIVERS)[number] | undefined,
  ) => Promise<CliTestProbe>;
  resetPathCache?: () => void;
  findCliCandidates?: (name: string) => string[];
}

export function createCliTestRoutes(deps: CliTestRouteDeps): RouteHandler {
  const reset = deps.resetPathCache ?? resetPathCache;
  const find = deps.findCliCandidates ?? findCliCandidates;
  return async ({ req, res, url, path, method, json, readBody }) => {
    // ── CLI binary discovery for the Engines "detected" dropdown ──
    // ?name=claude → absolute paths of every `claude` on the augmented PATH,
    // in PATH order (first = what a bare name runs). Polled when the user
    // opens the Custom picker so a just-installed CLI appears without a restart.
    if (method === "GET" && path === "/api/cli-candidates") {
      const name = url.searchParams.get("name") ?? "";
      reset();
      return json(res, 200, { candidates: find(name) });
    }

    // ── pre-save CLI probe: does this path actually run? ──
    // POST {cli, driver} → spawn `<cli> --version` with the same PATH the
    // turn itself would use. A miss here (typo, missing exec bit, a binary
    // the GUI app can't see) means every turn would fail, so the UI asks
    // before saving rather than registering a dead engine.
    if (method === "POST" && path === "/api/cli-test") {
      // same gate as the local-VM lifecycle routes: this executes a local
      // binary, so a hostile page must not be able to submit it as a simple
      // text/plain cross-origin request
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      // A hosted server's engines are managed in Admin: nothing here to save,
      // so nothing to probe on that machine either.
      if (deps.hostedModels) return json(res, 403, { error: HOSTED_PROVIDER_SETTINGS_ERROR });
      const body = await readBody(req) as { cli?: unknown; driver?: unknown } | null;
      const cli = typeof body?.cli === "string" ? body.cli.trim() : "";
      if (!cli || /[\n\r]/.test(cli)) return json(res, 400, { error: "cli must be a non-empty path" });
      const refusal = cliCommandRefusal(cli);
      if (refusal) return json(res, 400, { error: refusal });
      const driver = typeof body?.driver === "string" ? BUILT_IN_DRIVERS.find((d) => d.driverKind === body.driver) : undefined;
      // Probe the exact configured wrapper plus --version. testCliBinary uses
      // a credential-redacted environment, so fixed wrapper arguments cannot
      // turn this endpoint into an inherited-secret reader.
      const probe = await deps.testCliBinary(cli, driver);
      return json(res, 200, probe);
    }

    return PASS;
  };
}
