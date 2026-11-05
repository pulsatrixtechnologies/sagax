// The reserve follows the people at work (2026-10-26, cold start).
//
// A reserve node (the chart's spare placeholders, warmNode.spare) lets the
// next person who arrives preempt a placeholder and start in 8 to 20 s
// instead of waiting about 80 s for a new node. Kept by a schedule, it costs
// a node for every hour of the schedule, people or not. Decision: no reserve
// while nobody works, a reserve as soon as someone does, and none once the
// most people expected at once are there (at most 4).
//
// The provisioner already knows who works: the sandbox Pods of its
// namespace. Every SPARE_TICK_MS (and right after an environment starts or
// stops) it counts them and sets the spare Deployment's replicas:
//
//   active = 0                       -> 0
//   active >= maxActive              -> 0 (no one else is expected)
//   otherwise                        -> min(count, maxActive - active)
//
// It reads and writes only the scale of that one Deployment (a Role on
// deployments/scale with its resourceName, chart provisioner.spareScaler).
// A failure is logged and changes nothing else: the person's own Pod never
// waits on the reserve. Off unless SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT is set.
import type { K8sClient } from "./sandboxd-k8s-client.ts";
import { SANDBOX_INSTANCE_LABEL, SANDBOX_USER_LABEL } from "../sandbox/user-sandbox-spec.ts";

export const SPARE_TICK_MS = 15_000;
const NAME_RE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

export interface SpareConfig {
  namespace: string;
  deployment: string;
  /** Reserve Pods (one per reserve node) while someone works. */
  count: number;
  /** The most people expected at once: no reserve from this many. */
  maxActive: number;
}

/** From the environment, or null when the reserve is not driven here. */
export function spareConfigFromEnv(env: NodeJS.ProcessEnv, maxRunning: number): SpareConfig | null {
  const raw = env.SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT?.trim();
  if (!raw) return null;
  const [namespace, deployment, extra] = raw.split("/");
  if (extra !== undefined || !namespace || !deployment || !NAME_RE.test(namespace) || !NAME_RE.test(deployment)) {
    throw new Error("SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT must be <namespace>/<deployment>");
  }
  const count = intIn(env.SAGAX_SANDBOX_K8S_SPARE_COUNT, 1, 0, 8, "SAGAX_SANDBOX_K8S_SPARE_COUNT");
  const maxActive = intIn(env.SAGAX_SANDBOX_K8S_SPARE_MAX_ACTIVE, maxRunning, 1, 64, "SAGAX_SANDBOX_K8S_SPARE_MAX_ACTIVE");
  return { namespace, deployment, count, maxActive };
}

function intIn(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

/** Pure: the reserve for this many people at work. */
export function desiredSpare(active: number, config: Pick<SpareConfig, "count" | "maxActive">): number {
  if (active <= 0 || active >= config.maxActive) return 0;
  return Math.min(config.count, config.maxActive - active);
}

type Obj = Record<string, unknown>;

/** Pods that are a person at work or on the way: not finished, not deleted. */
function activePods(items: Obj[]): number {
  return items.filter((pod) => {
    const meta = (pod.metadata ?? {}) as Obj;
    if (meta.deletionTimestamp) return false;
    const phase = String(((pod.status ?? {}) as Obj).phase ?? "");
    return phase !== "Succeeded" && phase !== "Failed";
  }).length;
}

export class SpareScaler {
  private running: Promise<void> | null = null;
  private again = false;
  private lastLogged: number | null = null;

  private readonly client: K8sClient;
  private readonly sandboxNamespace: string;
  private readonly instance: string;
  private readonly config: SpareConfig;
  private readonly log: (line: string) => void;

  constructor(client: K8sClient, sandboxNamespace: string, instance: string, config: SpareConfig, log: (line: string) => void = (line) => console.log(line)) {
    this.client = client;
    this.sandboxNamespace = sandboxNamespace;
    this.instance = instance;
    this.config = config;
    this.log = log;
  }

  /** Count and set now; one at a time (a call during a run runs once more after). */
  reconcile(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try { await this.once(); } catch (error) {
          this.log(`sandboxd: spare reserve not updated: ${error instanceof Error ? error.message : String(error)}`);
        }
      } while (this.again);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async once(): Promise<void> {
    const selector = encodeURIComponent(`${SANDBOX_USER_LABEL},${SANDBOX_INSTANCE_LABEL}=${this.instance}`);
    const pods = await this.client.request("GET", `/api/v1/namespaces/${this.sandboxNamespace}/pods?labelSelector=${selector}`);
    if (pods.status !== 200) throw new Error(`pod list answered ${pods.status}`);
    const active = activePods(((pods.body ?? {}) as Obj).items as Obj[] ?? []);
    const want = desiredSpare(active, this.config);
    const path = `/apis/apps/v1/namespaces/${this.config.namespace}/deployments/${this.config.deployment}/scale`;
    const scale = await this.client.request("GET", path);
    if (scale.status === 404) throw new Error(`deployment ${this.config.namespace}/${this.config.deployment} not found`);
    if (scale.status !== 200) throw new Error(`scale read answered ${scale.status}`);
    const current = Number((((scale.body ?? {}) as Obj).spec as Obj | undefined)?.replicas ?? 0);
    if (current === want) return;
    const patched = await this.client.request("PATCH", path, { spec: { replicas: want } }, "application/merge-patch+json");
    if (patched.status !== 200) throw new Error(`scale write answered ${patched.status}`);
    if (this.lastLogged !== want) this.log(`sandboxd: spare reserve ${current} -> ${want} (${active} at work)`);
    this.lastLogged = want;
  }
}
