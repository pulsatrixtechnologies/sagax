# Kubernetes sandboxes

`SANDBOX_BACKEND=kubernetes` runs sagax-sandboxd against the Kubernetes API.
`docker` stays the default: an empty value, or `docker`, still uses
`docker.sock` and is unchanged. The Kubernetes path does not open that socket
and does not start a privileged egress helper. One person is one Pod and one
PVC (`sagax-user-<key>`, `sagax-user-<key>-workspace`) in the namespace
`sandboxes`. The key is the same 32-hex digest as the Docker backend.
There is no bot parameter.

The cluster can be k3s, AKS, EKS, LKE or a Kubernetes on Proxmox. The
provisioner calls only the Kubernetes API. It does not call a cloud API, and
the manifests do not create a load balancer. The operator supplies a
StorageClass.

## What the provisioner creates

| Object | Name | Notes |
|---|---|---|
| Pod | `sagax-user-<key>` | uid 1000, read-only root, drop all capabilities, seccomp RuntimeDefault, no token, no host namespaces, requests equal limits |
| PVC | `sagax-user-<key>-workspace` | ReadWriteOnce, the operator StorageClass, size `SAGAX_SANDBOX_DISK_MB` (32768 by default; a smaller existing claim is grown before each start, `sandbox.pvc.grow` in the audit) |
| NetworkPolicy | `sagax-user-<key>-net` | no ingress; egress `0.0.0.0/0` except the deny list; no IPv6 |
| NetworkPolicy | `sagax-default-deny` | every Pod in the namespace; no ingress and no egress |

Pause writes `sagax.pulsatrix.com/paused=true` on the PVC and deletes the
Pod, so the memory is released. Inspect still reports the sandbox running and
paused, and it keeps its capacity slot. Resume clears the annotation and
creates the Pod again. Stop clears the annotation, deletes the Pod and keeps
the PVC. Core Kubernetes has no portable cgroup freeze and no per-pod pid or
file-size rlimit; the pid cap is only the annotation
`sagax.pulsatrix.com/pids-limit`. Set the kubelet `podPidsLimit` on the
sandbox node pool only (AKS: `podMaxPids` in the node pool kubelet config,
which can only be set when the pool is created). Keep it well above the
annotation, which also counts Chromium's threads, so no real use reaches it:
the point is that one sandbox can no longer exhaust the node's pids and take
its neighbours and the kubelet down.

Sandbox Pods use the ServiceAccount `sagax-sandbox-workload` (no Role, token
not mounted). DNS is public (`1.1.1.1`, `8.8.8.8`, or `SAGAX_SANDBOX_K8S_DNS`)
so the deny list can include the cluster CIDR. The resolver runs with
`single-request-reopen`: behind a NAT gateway (a dedicated egress address for
the sandbox pool), glibc's simultaneous A and AAAA queries from one socket
otherwise lose the second answer and every lookup waits 5 seconds.

A sandbox reaches the Kubernetes API's public address unless it is denied:
the deny list sees the address after the service translation, so
`kubernetes.default` is that public address too. Put the address the
`kubernetes` Endpoints object lists in `SAGAX_SANDBOX_EGRESS_DENY`, or, when
that address moves (AKS: at each cluster start), the API's name in
`SAGAX_SANDBOX_K8S_DENY_HOSTS`: the provisioner follows it and patches the
existing per-person policies (see "Control plane out of reach" below).
Policies built from `SAGAX_SANDBOX_EGRESS_DENY` alone keep their old list
until they are recreated. An address inside the deny list is refused at
startup.

Without a node selector and a toleration, sandbox Pods go wherever the
scheduler puts them, usually the system pool, and never on a dedicated pool
that carries a `NoSchedule` taint. To run them on that pool, set
`SAGAX_SANDBOX_K8S_NODE_SELECTOR` to the pool's label and
`SAGAX_SANDBOX_K8S_TOLERATION` to its taint, exactly as the pool was
created (the AKS command in `docs/ops/sandboxes/cutover-rollback.md` uses
label and taint `sagax.io/pool=sandboxes`). Both are optional. A malformed
value (missing `=` in a selector, an effect other than `NoSchedule`,
`PreferNoSchedule` or `NoExecute`, a key that is not a label key) refuses
the start. The provisioner itself stays off that pool.

### One kernel per person

runc shares the node's kernel between the sandboxes on that node. To give each
person their own kernel without the I/O cost of a microVM runtime, give each
person their own node, which is a VM of its own on every cloud:

1. A node pool sized for one sandbox (for example 2 vCPU, 8 GiB), labeled and
   tainted on its own (example: label `sagax.io/isolation=dedicated`, taint
   `sagax.io/dedicated=true:NoSchedule`), in the zone of the workspace disks
   when they are zonal, with the cluster autoscaler on.
2. `SAGAX_SANDBOX_K8S_HOST_USERS=false`, `SAGAX_SANDBOX_K8S_DEDICATED_NODE=1`,
   `SAGAX_SANDBOX_K8S_DEDICATED_NODE_SELECTOR` and
   `SAGAX_SANDBOX_K8S_DEDICATED_TOLERATION` set to that label and taint. The
   node is the person's, so `SAGAX_SANDBOX_K8S_DEDICATED_CPUS` and
   `SAGAX_SANDBOX_K8S_DEDICATED_MEMORY_MB` can size the sandbox to it.
   `SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST` can request a little less CPU
   than that limit (for example 1.3 under a 1.5 limit): the sandbox runs
   with the same limit, and a DaemonSet added to the pool later still
   leaves room to place it. Memory stays request = limit.
3. `warmNode.spare.enabled=true` in the chart, with
   `warmNode.spare.nodeSelector` and `warmNode.spare.tolerations` on that pool,
   and `SAGAX_SANDBOX_K8S_SPARE=<system namespace>/sagax-sandbox-spare`.
   Each reserve pod holds a node; a person who arrives evicts one at once
   instead of waiting for a new node, and the autoscaler refills the reserve.
   The provisioner keeps one reserve per active person, up to
   `SAGAX_SANDBOX_K8S_SPARE_MAX` (default 2), and none when nobody is active,
   so the first arrival on an idle pool waits for a node and every later
   one does not. Size `warmNode.spare.cpu` so that node allocatable minus it
   is less than one sandbox request. Sandbox pods on that pool carry
   `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`, so a short
   `scale-down-unneeded-time` removes idle nodes quickly and never a
   person's node.
4. Move people one at a time with `SAGAX_SANDBOX_K8S_DEDICATED_KEYS`, then `*`.
   A person moves on their next start (pause and resume). Removing a key moves
   that person back to the shared spec; the workspace volume is the same.
5. `admission.dedicated.enabled=true` with `validationActions: ["Warn", "Audit"]`
   while people move, `["Deny"]` once the key list is `*`.

`hostUsers: false` needs Kubernetes 1.33 or later with a runtime and kernel
that support idmapped mounts (containerd 2, Linux 6.3 or later). Inside the
sandbox nothing changes: uid 1000, the same image and the same volume.

The namespace default deny also selects the provisioner. Apply
`deploy/k8s/provisioner/networkpolicy-provisioner.yaml` first. That policy is
only the provisioner label: TCP 443 and 6443 out, TCP 8791 in. Set
`SAGAX_SANDBOX_K8S_API` to `https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT`
so the provisioner does not need cluster DNS. Point
`SAGAX_SANDBOX_AUDIT_SHIP_URL` at a collector on 443, or replace the audit
emptyDir, because that policy allows no other egress.

## Variables (kubernetes only)

| Variable | Required | Meaning |
|---|---|---|
| `SANDBOX_BACKEND` | `kubernetes` | selects this backend |
| `SAGAX_SANDBOX_K8S_NAMESPACE` | no | default `sandboxes`; must already exist |
| `SAGAX_SANDBOX_K8S_STORAGE_CLASS` | yes | operator StorageClass |
| `SAGAX_SANDBOX_K8S_REGISTRY` | yes | image registry prefix, lowercase, no trailing slash |
| `SAGAX_SANDBOX_K8S_REQUIRE_SIGNED` | no | default true: the image ref must end in `@sha256:<64 hex>` |
| `SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION` | no | default true: the StorageClass must advertise encryption |
| `SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED` | `true` | operator attestation that etcd encryption covers Secret |
| `SAGAX_SANDBOX_K8S_NETWORK_POLICY` | `enforced` | operator attestation that the CNI enforces NetworkPolicy |
| `SAGAX_SANDBOX_K8S_RUNTIME_CLASS` | no | optional RuntimeClass |
| `SAGAX_SANDBOX_K8S_PULL_SECRET` | no | name of a pull Secret, never the token |
| `SAGAX_SANDBOX_K8S_DNS` | no | 1 to 3 public IPv4 resolvers |
| `SAGAX_SANDBOX_K8S_DENY_HOSTS` | no | the cluster API's name (AKS: `az aks show --query fqdn`) or IPv4 addresses, at most 8; unset or empty, off (`KUBERNETES_SERVICE_HOST` is the `kubernetes` Service IP, never used); the Azure adapter sets it from the OpenTofu output `api_server_fqdn`: resolved at start (the provisioner refuses to start if it cannot) and every minute, each address denied as a `/32` in every person's policy, existing ones patched when it moves |
| `SAGAX_SANDBOX_K8S_QUOTA_NAME` | no | default `sagax-sandbox-quota` |
| `SAGAX_SANDBOX_K8S_NODE_SELECTOR` | no | `key=value[,key=value]`, Kubernetes label syntax, for example `sagax.io/pool=sandboxes`; becomes the Pod `nodeSelector` |
| `SAGAX_SANDBOX_K8S_TOLERATION` | no | `key=value:Effect` (operator Equal) or `key:Effect` (operator Exists), comma separated, for example `sagax.io/pool=sandboxes:NoSchedule`; becomes the Pod `tolerations` |
| `SAGAX_SANDBOX_K8S_HOST_USERS` | no | default `true`; `false` runs each sandbox Pod in a user namespace (`hostUsers: false`) |
| `SAGAX_SANDBOX_K8S_DEDICATED_NODE` | no | default off; `1` adds a required pod anti-affinity so no two sandboxes share a node |
| `SAGAX_SANDBOX_K8S_DEDICATED_KEYS` | no | `*` (default when unset) or sandbox keys, comma separated: who gets the two options above; empty moves everyone back |
| `SAGAX_SANDBOX_K8S_DEDICATED_NODE_SELECTOR` | with `DEDICATED_NODE` | label of the pool with one node per person, added to `SAGAX_SANDBOX_K8S_NODE_SELECTOR` |
| `SAGAX_SANDBOX_K8S_DEDICATED_TOLERATION` | no | that pool's taint, added to `SAGAX_SANDBOX_K8S_TOLERATION` |
| `SAGAX_SANDBOX_K8S_DEDICATED_CPUS` / `SAGAX_SANDBOX_K8S_DEDICATED_MEMORY_MB` | no | CPU (fractions allowed) and MiB for those people; default the shared `SAGAX_SANDBOX_CPUS` / `SAGAX_SANDBOX_MEMORY_MB` |
| `SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST` | no | CPU request below `SAGAX_SANDBOX_K8S_DEDICATED_CPUS` (the limit stays); needs `SAGAX_SANDBOX_K8S_DEDICATED_CPUS`; empty: request = limit |
| `SAGAX_SANDBOX_K8S_SPARE` | no | reserve Deployment as `namespace/name` (chart `warmNode.spare`, `sagax-sandbox-system/sagax-sandbox-spare`); the provisioner scales it |
| `SAGAX_SANDBOX_K8S_SPARE_MAX` | no | default `2`: reserve nodes = people active on the dedicated pool, capped here; 0 when nobody is active |
| `SAGAX_SANDBOX_K8S_API` | no | default `https://kubernetes.default.svc` |
| `SAGAX_SANDBOX_K8S_KUBECONFIG` | no | out-of-cluster auth; otherwise the Pod's ServiceAccount. `SAGAX_SANDBOX_K8S_USE_KUBECONFIG=1` uses `KUBECONFIG`, or `~/.kube/config` when that is unset |
| `SAGAX_SANDBOX_AUDIT_LOG` | no | default `/var/log/sagax/sandbox-audit.jsonl` |
| `SAGAX_SANDBOX_AUDIT_SHIP_URL` | no | https collector; credentials in the URL are refused |
| `SAGAX_SANDBOXD_TLS_CERT` / `SAGAX_SANDBOXD_TLS_KEY` | yes | provisioner certificate; `SAGAX_SANDBOXD_TLS_INSECURE=1` is a lab bypass and is audited |
| `SAGAX_SANDBOXD_TLS_CA` | client | Sagax server trusts this CA for `SAGAX_SANDBOXD_K8S_URL` (https only) |
| `SAGAX_SANDBOXD_K8S_URL` | client | Kubernetes provisioner. Docker stays `SAGAX_SANDBOXD_URL` |
| `SAGAX_SANDBOX_CANARY_PEOPLE` | client | principal ids sent to Kubernetes |
| `SAGAX_SANDBOX_CANARY_BOTS` | client | bot ids whose turns are sent to Kubernetes |
| `SAGAX_SANDBOX_ROUTE` | client | `kubernetes` sends everyone; `docker` sends everyone back |
| `SAGAX_SANDBOX_K8S_WAKE_URL` | client, no | secret https webhook that starts a stopped cluster (see "Cluster stopped when idle"); never logged, never passed to an engine |
| `SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS` | client, no | how long a call waits for the cluster to start; default `480000` (8 minutes), from `30000` to `540000` |

`latest`, a bare name (`sagax-sandbox:local`) and a registry outside the
prefix are refused. `ghcr.io/org` does not admit `ghcr.io/org-evil/...`.
The digest pin is the runtime control. Cosign is not called inside the
provisioner.

A StorageClass counts as encrypting when a parameter is `encrypted` or
`encryption` (`true`), when `diskEncryptionSetID` is set, or when the
annotation `sagax.pulsatrix.com/encrypted=true` is set. The annotation is
the portable switch after the operator has confirmed the CSI driver. Setting
it on kind's `local-path` does not encrypt anything; the kind script leaves
`SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION=false` and says so.

Readiness fails closed unless the namespace exists, the StorageClass
advertises encryption (when required), the ResourceQuota caps pods, memory,
cpu and storage, the image is admitted, both attestations are set, TLS
material is readable, and the audit directory is writable. The provisioner
cannot patch the quota.

CPU figures need metrics-server. Without it, stats report cpu 0 and memory 0,
and still report the memory limit.

## Cluster stopped when idle

An operator may stop the cluster when no sandbox Pod has run for a while
(for example a scheduled runbook that stops the cluster after 30 to 45
minutes with no Pod) and start it again through a webhook: one HTTPS
`POST` to a secret URL. Set that URL in `SAGAX_SANDBOX_K8S_WAKE_URL` on the
Sagax server and Sagax starts the cluster itself (`server/sandbox/sandbox-k8s-wake.ts`):

- A call routed to Kubernetes first checks the provisioner's unsigned
  `GET /healthz` (5 seconds; a provisioner seen healthy in the last minute
  is not checked again). No answer, a refused connection, a timeout or a
  502, 503 or 504 with no provisioner body counts as unreachable. An error
  the provisioner itself answers (a JSON `code`) does not.
- A bot's command, a person's MCP server command, Start, Resume, Reset and
  Update wake the cluster. Sagax posts the webhook, then polls `/healthz`
  with backoff (2 seconds, up to 15 seconds between tries) until it answers
  or `SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS` passes. Then the call runs.
- One wake at a time for the whole Sagax process. Every call that finds the
  cluster down waits on the same wake, and the webhook is posted at most
  once every 2 minutes, whatever the callers do. A webhook that failed is
  posted again only after that window.
- A call refused before it reached the provisioner (connection refused, no
  route, 503 from the load balancer) is sent once more after the wake. A
  timeout or a reset is not: the command may have run.
- Reads never wake it: the Computer tab, status, usage, the disk quota check
  and the voice call heartbeat. While the cluster is stopped the Computer
  tab shows the environment off (Start wakes it); during a wake it reads
  unavailable with the code `cluster_starting`.
- The running conversation shows one status row: "The server environment
  is starting. This can take a few minutes." (French: "Environnement en
  démarrage, ça peut prendre quelques minutes."). The tool call then
  resumes on its own. On timeout the call fails with "The server
  environment did not start in time. Send the message again in a few
  minutes." and a second row says so; the message can be sent again.
- There is no fallback to Docker. A workspace is never in two places.
- Docker calls are never gated, and without `SAGAX_SANDBOX_K8S_WAKE_URL`
  nothing changes: an unreachable provisioner fails the call as before.

The URL carries the webhook's token. It is read once at startup, never
logged (the log says "start webhook accepted", "answered 500" or
"unreachable (ENOTFOUND)"), never put in an error or an API answer, and
stripped from every engine's environment with the control plane secrets
(`CONTROL_PLANE_ENV`). Only https is accepted. A bad value stops the
server with a message that names the variable, not the value.

The default timeout (8 minutes) and the cap (9 minutes) stay under the 10
minute cut an engine puts on one tool call and the 12 minute cut of the
environment's MCP proxy, so the person gets the clear message rather than
a cut connection. An engine with a shorter tool timeout of its own (Codex
`tool_timeout_sec`) cuts the call earlier; the wake goes on, and the next
call joins it.

### Keeping the cluster up while it is used

Sagax sends no heartbeat and calls no Azure API other than the webhook.
The idle signal is the presence of sandbox Pods: a person's Pod exists from
the first command until the provisioner's idle stop
(`SAGAX_SANDBOX_IDLE_MINUTES`, default 10). Every command counts as use, a
command still running is never stopped, and a voice call's heartbeat
counts as use (`markUsed`). So the cluster stays up while anyone works,
and the stop timer of the runbook starts when the last Pod is gone.
After `SAGAX_SANDBOX_HIBERNATE_MINUTES` (default 60) a stopped sandbox is
hibernated: its NetworkPolicy goes too, the claim stays, and the next
command wakes it on the same claim.

### Cold start (2026-10-26)

Where a cold start goes, measured on an AKS cluster in canadacentral
(stopped while idle, sandbox pool at 0 nodes, 2026-10-27 00:55 UTC, from
the start webhook; `node scripts/k8s-wake-timeline.mjs events.json --from
<webhook time>` prints the same table from `kubectl get events -A -o json`):

| Step | Seconds | Share |
|---|---|---|
| Cluster start, system node Ready | 246 | 58 % |
| Provisioner image pull on the new system node | 67 | 16 % |
| Provisioner start, first status | 6 | 1 % |
| Autoscaler reaction | 11 | 3 % |
| Sandbox node added (0 to 1) | 71 | 17 % |
| Workspace volume attach | 7 | 2 % |
| Sandbox image pull (about 480 MB) | 12 | 3 % |
| Container start | 1 | 0 % |
| **Total, webhook to a running sandbox** | **427** | |

Four fifths of it is waiting for virtual machines (cluster start and a new
node), and the cluster keeps stopping when nobody works (it costs nothing
then). So the levers make each wait shorter, start it earlier, or keep a
node only while it is useful:

1. **A small provisioner image** (`deploy/k8s/provisioner/Dockerfile`,
   `sagax-sandboxd`): only Node and the bundled `dist-server/sandboxd.js`,
   353 MB unpacked (82 MB compressed) instead of the 1.6 GB server image.
   A started cluster's system node is a new VM with an empty cache; this
   cuts most of the 67 s pull, on every cold start.
2. **Wake while the person types.** The composer already tells the server
   when the person writes a message (`POST /api/bots/:id/warm` with
   `typing: true`); the server then pre-wakes their cloud computer
   (`UserSandboxManager.prewake`, once per person and bot every 2 minutes,
   `server/sandbox/sandbox-typing-prewake.ts`), only on Kubernetes with the cluster
   wake and only for a bot that used it in the last 7 days. The cluster and
   the node start while the message is being written. Opening a
   conversation or the Computer tab never wakes anything. Scheduled
   routines already pre-wake 12 minutes ahead (`PREWAKE_LEAD_MS`).
3. **A reserve that follows the people at work.** With the reserve
   placeholders of `warmNode.spare`, set
   `SAGAX_SANDBOX_K8S_SPARE_DEPLOYMENT=<system namespace>/sagax-sandbox-spare`
   on the provisioner and `provisioner.spareScaler.enabled: true` in the
   chart (a Role on that one Deployment's scale). The provisioner counts
   the sandbox Pods every 15 s (`server/sandboxd-k8s/sandboxd-k8s-spare.ts`): no reserve
   while nobody works, `SAGAX_SANDBOX_K8S_SPARE_COUNT` (default 1) while
   someone does, none once `SAGAX_SANDBOX_K8S_SPARE_MAX_ACTIVE` (default
   the running limit) are at work. It overrides the warm schedule's
   replicas; set them to 0 so a morning CronJob does not start a reserve
   for nobody. The reserve's node then goes with the autoscaler's
   scale-down delay (AKS default 10 minutes; `scale-down-unneeded-time` in
   the cluster autoscaler profile shortens it).

What a person then waits, measured on the same cluster (isolation trial of
2026-10-26, image 0.8.3):

| Case | Pod Ready |
|---|---|
| Cluster up, a node ready (a reserve, or a node already up) | 8 to 20 s |
| Cluster up, a new workspace preempting a reserve | 27 s |
| Cluster up, nobody at work, no reserve (new node) | 83 s |
| Cluster stopped (outside office hours) | about 6 minutes, started at the first keystroke |

Only the first person of a cold period waits for a node, and that wait
overlaps with their message. Cost: a reserve node is billed only while
someone works (one D4ps_v6 is about 0.16 USD an hour), and nothing while
nobody does.

Zones: Azure Premium_LRS disks are zonal. A person's workspace disk lives
in the zone where it was first created, and its Pod can only run on a node
of that zone. With a pool spread over three zones, the warm node may sit
in another zone than a person's disk: that person's Pod then waits for a
new node in the right zone (a cold start again), or stays Pending when the
autoscaler cannot add one there. Pin the sandbox pool to the zone of the
disks, or use a ZRS StorageClass (`skuName: Premium_ZRS`) for new
workspaces. StorageClass parameters cannot change in place: a ZRS class is
a new class, and existing disks move by snapshot.

What the screen says, without starting anything: the Computer tab and the
phone read the status with `peek` (never the webhook). A stopped cluster
reads off (Start or the next bot turn starts it); a wake in progress reads
starting with how long so far; and a Pod on its way up (a node being
added, the volume attaching, the image pulling) reads `starting: true`
beside `state: "stopped"`, shown as starting with no Start button, where
it used to read off.

What the runbook must do: count only sandbox Pods, those with the label
`com.pulsatrix.sagax.sandbox.user` in the sandbox namespace, never the
provisioner (`app=sagax-sandboxd`), which always runs. A paused
environment has no Pod and does not keep the cluster up; Resume wakes it.
The webhook should be harmless on a cluster that is already running
(Sagax may post it when only the provisioner restarted). Stop and delete
of a person signed out by Perspicax do not wake the cluster: they fail
while it is stopped and the pending deletion is tried again every 5
minutes.

## Cloud agent runs

A cloud agent run (Perspicax spec `2026-10-18-cloud-agents-design.md`, lot
P1.3) gets its own Pod, never a person's sandbox. The same provisioner
serves it, on a second listener that only knows `/v1/runs`
(`server/sandbox/sandboxd-runs.ts`, pure objects in `server/sandbox/sandboxd-runs-spec.ts`).
Off unless `SAGAX_RUNS_ENABLED=1`; nothing else changes when it is off.

Who may call it: Perspicax only. Three locks, all required:

1. **Mutual TLS.** The run listener requests a client certificate and
   refuses the handshake unless `SAGAX_RUNS_TLS_CLIENT_CA` signed it
   and its common name is `SAGAX_RUNS_TLS_CLIENT_CN` (required). Session
   tickets are off, so every connection shows its certificate. The
   server certificate is the provisioner's. There is no insecure mode:
   `SAGAX_SANDBOXD_TLS_INSECURE` refuses the start when runs are on.
2. **Its own key.** `sagax-sandboxd-runs-key` (`SAGAX_RUNS_KEY_FILE`, a
   mounted Secret, never generated) signs every call with the same HMAC
   scheme as the sandbox routes, under its own context
   (`sagax-sandboxd-runs-v1`). The start refuses a run key equal to the
   sandbox key. A sandbox signature never verifies on the run listener,
   and the sandbox listener serves no `/v1/runs`.
3. **Its own namespace** (`sandbox-runs`). The provisioner's Role there
   covers Pods, PVCs, NetworkPolicies, `create` and `delete` on Secrets
   (the run token) and nothing else: no exec, no logs, no read of a
   Secret. The sandbox namespace is never touched by a run call.

| Method and path | Job |
|---|---|
| `POST /v1/runs` | Create the run: NetworkPolicy, PVC, Pod, then the token Secret owned by the Pod. A retry for a live Pod returns it (`created: false`). |
| `GET /v1/runs` | Every run, with `active`, `maxPods`, `maxPerOwner`. |
| `GET /v1/runs/<id>` | `phase` (`pending`, `running`, `succeeded`, `failed`, `stopped`), `reason` (`expired`, `evicted`, `Unschedulable`...), `workspaceExpiresAt`. |
| `DELETE /v1/runs/<id>?keepWorkspace=1` | Stop: the Pod goes (its token with it), the disk stays for a follow-up. Without the flag the disk and the policy go too. |

The create body is closed: `id`, `envId`, `ownerKey` (opaque, 32 hex),
`image`, `token`, `egress`, and optional `cpuMillis`, `memoryMiB`,
`diskGiB`, `maxDurationSec`. Any other field is refused, so no command,
variable, volume, node or network can ride along. The image's own
entrypoint runs (the runner of lot P1.4).

What a run Pod is:

- `run-<id>`, PVC `run-<id>-ws`, NetworkPolicy `run-<id>-net`, Secret
  `run-<id>-token` (mounted read-only at `/var/run/px-run/token`; the only
  credential in the Pod; never in the Pod spec, the audit line or an
  answer). Labels `px.run`, `px.env`, `px.owner`,
  `com.pulsatrix.sagax.run=1`; never a person-sandbox label.
- uid 1000, `runAsNonRoot`, read-only root (writable: `/workspace`, `/tmp`,
  `/dev/shm`), no capability, seccomp `RuntimeDefault`, no service account
  token (`sagax-run-workload`), no port, `restartPolicy: Never`.
- Image: exactly one of `SAGAX_RUNS_ALLOWED_IMAGES`, each
  `name:tag@sha256:<digest>` under `SAGAX_SANDBOX_K8S_REGISTRY`.
- Limits (decision D3): 4 vCPU and 8 Gi by default, at most 8 vCPU, 16 Gi,
  a 20 Gi disk (10 Gi by default) and 12 h (4 h by default). At most 12
  live run Pods and 4 per person (`SAGAX_RUNS_MAX_PODS`,
  `SAGAX_RUNS_MAX_PER_OWNER`); Perspicax enforces its own quotas first, this
  is the backstop, and the namespace ResourceQuota `sagax-run-quota` is the
  last one.
- Hard deadline: `activeDeadlineSeconds` = the run's maximum + 20 min.
- Placement: `nodeSelector px.pool=runs`, tolerations `px.run=true:NoSchedule`
  and the AKS Spot taint (pool of lot P0.3).
- Network: no ingress. Egress to the cluster DNS, to Perspicax
  (`SAGAX_RUNS_PERSPICAX_CIDRS`, each a /32, never inside the sandbox
  subnet pool or `SAGAX_RUNS_K8S_INTERNAL_CIDRS`) and, for the `restreint`
  profile, to GitHub (`SAGAX_RUNS_GITHUB_CIDRS`: the git, api and web
  ranges of GitHub's meta list, public, /20 or narrower; never its actions
  or codespaces blocks), on
  TCP 443. `aucun` is Perspicax only. `defaut` (open internet) is refused
  until the egress proxy exists. Metadata, link-local and WireServer
  ranges are refused in any list.

Retention (decision D4), by a sweep every minute: an ended Pod is deleted
15 min after it ended, a Pod still Pending after 15 min is deleted, any Pod
past the hard cap is deleted; a disk is deleted 24 h after its run ended
(`sagax.pulsatrix.com/run-ended-at`), with its policy. An orphan disk
starts its clock when the sweep first sees it.

| Variable | Default | Meaning |
|---|---|---|
| `SAGAX_RUNS_ENABLED` | off | serve runs |
| `SAGAX_RUNS_LISTEN` | `0.0.0.0:8792` | run listener (its own port) |
| `SAGAX_RUNS_KEY_FILE` | `/run/sagax-sandboxd-runs/key` | run key, 64 hex |
| `SAGAX_RUNS_TLS_CLIENT_CA` | required | CA of the Perspicax client certificate |
| `SAGAX_RUNS_TLS_CLIENT_CN` | required | common name of the client certificate |
| `SAGAX_RUNS_K8S_NAMESPACE` | `sandbox-runs` | must differ from the sandbox namespace |
| `SAGAX_RUNS_K8S_STORAGE_CLASS` | the sandbox class | encrypted class for run disks |
| `SAGAX_RUNS_K8S_QUOTA_NAME` | `sagax-run-quota` | readiness requires its caps |
| `SAGAX_RUNS_ALLOWED_IMAGES` | required | run images by digest |
| `SAGAX_RUNS_K8S_NODE_SELECTOR` | `px.pool=runs` | never empty |
| `SAGAX_RUNS_K8S_TOLERATION` | `px.run=true:NoSchedule,kubernetes.azure.com/scalesetpriority=spot:NoSchedule` | |
| `SAGAX_RUNS_PERSPICAX_CIDRS` | required | Perspicax addresses, /32 each |
| `SAGAX_RUNS_K8S_INTERNAL_CIDRS` | none | pod, service and API ranges no egress list may overlap |
| `SAGAX_RUNS_GITHUB_CIDRS` | none | GitHub ranges (`restreint`) |
| `SAGAX_RUNS_CONTROL_URL` | required | `https` or `wss` runner endpoint, passed as `PX_CONTROL_URL` |
| `SAGAX_RUNS_MAX_CPU_MILLIS`, `_MAX_MEMORY_MIB`, `_MAX_DISK_GIB`, `_MAX_DURATION_MIN` | 8000, 16384, 20, 720 | ceilings, never above these |
| `SAGAX_RUNS_MAX_PODS`, `SAGAX_RUNS_MAX_PER_OWNER` | 12, 4 | live run Pods |
| `SAGAX_RUNS_POD_RETENTION_MIN`, `SAGAX_RUNS_DISK_RETENTION_HOURS` | 15, 24 | retention |

The chart renders the run namespace when `runs.enabled` (namespace with
Pod Security `restricted`, `sagax-run-workload`, the Role and binding,
`sagax-run-quota`, a LimitRange, default deny, the ingress policy of the
run port from `runs.callerCidrs`, and the admission policy
`sandboxes-runs`: one container from `runs.allowedImages`, its own
entrypoint, no port, read-only root, no token, a deadline, the runs pool).
The chart refuses to render without an image allowlist pinned by digest
or without `runs.callerCidrs`.

The provisioner Deployment uses `strategy: Recreate`: the run quotas are
counted in one process. The ingress policy of the run port matches the
caller's real address, so its Service keeps `externalTrafficPolicy: Local`.
The admission policy also covers `pods/ephemeralcontainers`.

The idle signal of the cluster stop must also count run Pods: label
`com.pulsatrix.sagax.run=1` in the run namespace. A stopped cluster is
woken by Perspicax before it calls `POST /v1/runs`.

### Build cache (coding runs)

Rust builds are big and must stay fast (gap I5, decision D3). A coding run
gets a second disk, its **build cache**, that outlives the run and goes to
the same person's next run: sccache, the cargo targets, the cargo registry,
the toolchains a repository pins, the pnpm store. Off unless
`SAGAX_RUNS_CACHE_ENABLED=1`; without it a run is exactly as above and the
image keeps its caches in `$HOME/.px-cache` on the run's own disk.

- One disk per person and concurrent slot: PVC
  `run-cache-<ownerKey>-<slot>`, labels `com.pulsatrix.sagax.run-cache=1`,
  `px.owner`, `px.cache-slot` (never `com.pulsatrix.sagax.run`, so it is
  never listed or swept as a run). A run takes the warmest free disk of its
  person; a concurrent run opens the next slot, up to
  `SAGAX_RUNS_CACHE_SLOTS`. The choice is made in the create queue, so two
  runs never get the same ReadWriteOnce disk.
- Mounted at `/cache` (`PX_CACHE_DIR`), the Pod labelled `px.cache=<claim>`.
  The run spec check refuses a cache disk of another person and any other
  foreign claim.
- The cache class must advertise encryption, like the run class.
- Retention: the sweep deletes a cache disk idle for
  `SAGAX_RUNS_CACHE_RETENTION_DAYS` (`sagax.pulsatrix.com/cache-used-at`)
  that no Pod references, audit `run.sweep.delete-cache`.

The image (`deploy/run-dev/Dockerfile`, `sagax-run-dev`, built by
`scripts/build-run-dev-image.sh`, never pushed by a script) is the run image
plus Rust (`rust-toolchain.toml` pin, clippy, rustfmt), clang and mold,
sccache, pnpm, Playwright's headless Chromium and `fast-gate`. Its entrypoint
`px-cache-init` sets `CARGO_TARGET_DIR=/cache/target/<envId>` (one target per
environment, so repositories never collide), `SCCACHE_DIR=/cache/sccache`
(40 % of the disk, shared by all environments), `CARGO_HOME`,
`RUSTUP_HOME`, `PNPM_STORE_DIR`, then starts `px-cache-gc`: every 30 min,
above 80 % of the disk, it frees down to 60 %: old incremental sessions,
target files unread for 7 days, the other environments' targets (least
recently used first), the extracted cargo sources, the current target last.

| Variable | Default | Meaning |
|---|---|---|
| `SAGAX_RUNS_CACHE_ENABLED` | off | give coding runs a build cache disk |
| `SAGAX_RUNS_CACHE_STORAGE_CLASS` | `px-run-cache` | encrypted, fast class |
| `SAGAX_RUNS_CACHE_GIB` | 64 | disk size, 8 to 1024 |
| `SAGAX_RUNS_CACHE_SLOTS` | `SAGAX_RUNS_MAX_PER_OWNER` | disks per person |
| `SAGAX_RUNS_CACHE_RETENTION_DAYS` | 14 | idle days before the sweep deletes it |

Turning it on (an operator step, after the go-ahead): build and publish the
image by digest and add it to `runs.allowedImages` and
`SAGAX_RUNS_ALLOWED_IMAGES`; apply the chart with
`values-azure-run-cache.yaml` (StorageClass `px-run-cache`, Premium SSD v2,
quota raised for the cache disks; `deploy/k8s/sandboxes/adapters/azure/storageclass-run-cache.yaml`
for the kustomize path); pin the runs node pool to zones (Premium SSD v2 is
zonal); set the variables above on the provisioner.

Measured with `scripts/measure-rust-build.sh` on Perspicax `px-agents`
(16 CPU, dev profile, line-tables-only), 2026-11-07:

| Build | Time | What it stands for |
|---|---|---|
| cold, no cache | 48.4 s | a run without the cache disk, every run |
| cold, filling sccache | 56.7 s | the person's first run |
| empty target, warm sccache | 36.1 s | a new environment, or a target the GC emptied |
| one file touched, target kept | 1.1 s | the next run on the same environment |
| nothing changed | 0.3 s | |

Target 2.3 GB and sccache 248 MB for this crate: a 64 GiB disk holds about
20 such environments before the GC starts at 80 %. sccache refuses a
set `CARGO_INCREMENTAL`, so the image leaves it unset: the workspace's own
crates stay incremental in the dev profile (in the target, uncached) and
sccache caches the dependencies.

## Images

`scripts/build-sandbox-image.sh` builds `linux/amd64` and `linux/arm64` to a
local OCI archive. It exits if `SANDBOX_IMAGE_PUSH=1`. It does not sign and
does not scan. `scripts/scan-sandbox-image.sh` runs trivy and fails if trivy
is missing or a HIGH or CRITICAL finding is present.
`scripts/verify/release/verify-sandbox-image-signature.sh` runs cosign only when
`COSIGN_PUBLIC_KEY` is set. `.github/workflows/sandbox-image.yml` is
`workflow_dispatch` only, does not push, and its signature step says it did
not verify a signature. A dispatch on a runner without trivy fails the scan
step. That failure is not a scan.

The Debian base is multi-arch. Publish, sign and scan remain operator steps
against the registry named by `SAGAX_SANDBOX_K8S_REGISTRY`.

## Clouds

Same API on each. Only the operator's StorageClass, CNI and the way they
publish the ClusterIP differ.

| Place | StorageClass (operator) | NetworkPolicy | Publishing the provisioner |
|---|---|---|---|
| k3s | the encrypted class the operator installed | flannel does not enforce NetworkPolicy; add kube-router or Cilium, then set the attestation | in-cluster DNS or an internal address |
| AKS | a class with `diskEncryptionSetID`, or the encrypted annotation after confirming the disk set | Azure CNI or Calico, when policy is on | internal Service; this chart does not create one |
| EKS | the encrypted EBS class the operator installed | the VPC CNI policy add-on, when installed | internal Service |
| LKE | the encrypted Linode class the operator installed | the cluster CNI, when it enforces policy | internal Service |
| Proxmox / k3s | the encrypted CSI class the operator installed | same as k3s | internal Service |

## Exec variables

A Kubernetes exec carries only a command line: no environment, user or
working directory (the pod's own). The variables a caller hands over
(`write_file` contents, `computer_use` text and addresses, `browse`
screenshots, the GitHub connection, the desktop passwords, a person's MCP
server variables) go on stdin as one JSON object whose size the command
names; a python3 loader in the sandbox image reads exactly that many bytes,
sets them and execs the real command (`withExecEnv` in
`server/sandboxd-k8s/sandboxd-k8s.ts`). They never ride the command line, which is in
the API server's request URL and in the process list. The in-chat terminal
keeps no variable (`TERM` stays the pod's).

## Audit

`server/sandbox/sandbox-audit.ts` opens the log with `O_APPEND | O_CREAT | O_WRONLY |
O_NOFOLLOW`, mode `0640`, and `fsync`s each line. It never truncates. A line
is `{v, ts, action, outcome, key?, detail?}`. Exec records the program name
and the exit code, not the arguments, the environment or a secret. An
optional collector is `POST` of that line to an https URL with no userinfo
and redirects treated as errors. A failed POST does not remove the line.
HTTP ship URLs are refused.

The audit directory must outlive the Pod. An `emptyDir` loses the trail on
every restart; mount a volume that keeps it (on AKS, an Azure Files claim:
ReadWriteMany, so a rolling update can start the new Pod before the old one
stops, and not zonal, unlike an Azure Disk on a multi-zone pool).

Kubernetes Events are a best-effort copy. The Role allows `create` and not
`patch`, `update` or `delete`. Events expire. The file is the record.

## SOC 2

Controls are the AICPA Trust Services Criteria. A row is evidence only for
what the artifact actually shows. Flags, a kind cluster and an unrun
workflow are not evidence.

| Change | Criteria | What this repo can show | What it does not show |
|---|---|---|---|
| ServiceAccount `sagax-sandboxd` with a namespace Role; sandbox Pods use `sagax-sandbox-workload` with no Role and no token; no `docker.sock`; no `cluster-admin` | CC6.1, CC6.3 least privilege; CC6.2 no shared admin credential for the workload | `deploy/k8s/provisioner/rbac.yaml`, the Pod security context in `podFromDockerSpec` | The kind kubeconfig is cluster-admin and must not be the production credential. An admin who applies the manifests still exists outside this Role. |
| Provisioner TLS required; the Sagax client accepts https only with `SAGAX_SANDBOXD_TLS_CA` | CC6.6, CC6.7 transmission restricted to an authenticated channel | `startKubernetesProvisioner` refuses to listen without the cert unless `SAGAX_SANDBOXD_TLS_INSECURE=1`, and that bypass is an audit line; `validSandboxdUrl` | The insecure flag is a lab switch. Traffic from kubelet to the runtime is the cluster's. |
| Per-sandbox NetworkPolicy (public IPv4 only, no ingress, no IPv6) and a namespace default deny; provisioner limited to 443, 6443 and 8791 | CC6.6 boundary protection | `sandboxNetworkPolicy`, `defaultDenyNetworkPolicy`, `networkpolicy-provisioner.yaml` | Enforcement is the attestation `SAGAX_SANDBOX_K8S_NETWORK_POLICY=enforced`. The API cannot show that the CNI implements the objects. k3s flannel and kindnet do not. |
| Registry prefix plus digest pin; tag `latest` refused | CC6.8 unauthorized software | `imageAdmissionProblems` | A digest is not a signature. This change does not sign an image. |
| Local multi-arch build that cannot push; trivy script fails closed; cosign script refuses to skip quietly | CC6.8 | `scripts/build-sandbox-image.sh`, `scripts/scan-sandbox-image.sh`, `scripts/verify/release/verify-sandbox-image-signature.sh`, `sandbox-image.yml` | No image was published, scanned or signed by landing this change. A workflow that has not been run produced no report. The workflow's signature step records that it did not verify one. |
| StorageClass encryption check; Secret encryption required as an attestation | C1.1 confidentiality, encryption at rest | `storageClassEncrypts`; startup fails without `SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED=true` | The API cannot show etcd `EncryptionConfiguration`. An annotation can be set on a class that does not encrypt. kind `local-path` is not encryption, and the integration test turns the check off. |
| Append-only audit file, fsync, no-follow, https ship, Events create-only | CC7.1, CC7.2 monitoring; CC4.1 the record used to evaluate the control | `server/sandbox/sandbox-audit.ts`; Role verb `create` on Events | The Deployment's audit volume is emptyDir unless the operator replaces it. Ship failures are logged and do not block. Events expire. A collector has to be operated. |
| Per-Pod requests and limits; ResourceQuota read-only to the provisioner; readiness requires caps on pods, cpu, memory and storage | A1.2 capacity | `quotaProblems`, `podFromDockerSpec` resources, Role verbs `get` and `list` on quotas | The sample numbers in `resourcequota.yaml` are not sized for a given cluster. Pause releases memory, so a paused slot does not consume the Pod's memory the way `docker pause` does. Pid and file-size rlimits are not enforced by core Kubernetes. |

## Tests

Unit tests do not need a cluster: `server/sandboxd-k8s/sandboxd-k8s-spec.test.ts`,
`server/sandboxd-k8s/sandboxd-k8s.test.ts`, `server/sandbox/sandboxd-runs-spec.test.ts` and
`server/sandbox/sandboxd-runs.test.ts` (the run listener over real mutual TLS). The kind script
`scripts/sandbox-k8s-kind.sh` runs `server/sandboxd-k8s/sandboxd-k8s.integration.test.ts`
only when `SAGAX_SANDBOX_K8S_INTEGRATION=1`, then deletes the cluster. It is
not part of `pnpm test:unit`.

## Key rotation

The provisioner and Sagax share one HMAC key (`SAGAX_SANDBOXD_KEY_FILE`).
The file may hold two keys, one per line, during a rotation: the first line
signs, every line verifies, and both sides reread the file within 5 seconds
of a change (`sandboxdKeySource` in `server/sandbox/sandboxd-auth.ts`), so no service
restarts and no request fails. A file that turns unreadable or malformed
keeps the last good keys. Three moves, each verified before the next:

1. Provisioner file: `old` then `new` (the Kubernetes Secret, or the Docker
   volume). Both keys verify; Sagax still signs with `old`.
2. Sagax file: `new` then `old`. Sagax signs with `new`.
3. Both files: `new` alone, once no request signed with `old` is in flight
   (more than 30 seconds after step 2).

Generate the new key where it is stored (a key vault) and move it from there
to the files without printing it. A release older than this rotation reads a
two-line file as malformed: update both sides first.

## Provisioner guard

The provisioner Role cannot say "exec only into a sandbox" or "write only
this NetworkPolicy shape". The chart's `admission.provisionerGuard` adds a
ValidatingAdmissionPolicy for the provisioner identity: exec only into
`sagax-user-*` Pods, and NetworkPolicies only of the two shapes the
provisioner writes (the namespace default deny, or a person's policy with no
ingress and egress to `0.0.0.0/0` minus every `egressDeny` range). The
NetworkPolicy verbs themselves stay: each person's policy is created and
deleted with their sandbox.

## Gaps

- No portable per-Pod pid limit (the kubelet's node pool setting is per
  pool, see above) and no `RLIMIT_FSIZE`.
- Pause deletes the Pod. The slot stays taken; the memory does not.
- Without metrics-server, CPU and current memory stats are 0.
- etcd encryption and CNI enforcement are attestations.
- This repository change does not publish, sign or scan an image.
- kind is a functional check of the API adapter. It is not evidence for
  encryption, signatures, vulnerability scan or NetworkPolicy enforcement.
- The integration kubeconfig is cluster-admin. Production uses the
  ServiceAccount in `rbac.yaml`.

## Control plane out of reach

Two paths stay open to a sandbox whatever the deny list says:

- The API server. On AKS its public IP changes at each cluster start, and
  the `kubernetes` Service IP is translated to that public IP before Azure
  NPM evaluates the policy, so `10.0.0.0/8` does not cover it.
  `SAGAX_SANDBOX_K8S_DENY_HOSTS` names the API's FQDN: the provisioner
  denies its current addresses and follows them. The Azure adapter sets it
  (`sandboxd-deny-hosts.yaml`) from the OpenTofu output `api_server_fqdn`;
  left as the placeholder, the provisioner refuses to start. The stable fix is API Server VNet Integration with the
  NAT address taken out of the authorized ranges, on by default in the Azure
  adapter (`api_server_vnet_integration`). It closes the public endpoint only
  with `api_server_authorized_ip_ranges` set (required in production).
- The node itself (kubelet `10250`, `sshd`, host ports): a pod reaches its
  own node's addresses without the policy being consulted. The chart's
  `nodeGuard` (a privileged DaemonSet on the sandbox nodes, digest-pinned
  busybox, on by default) adds an iptables chain `SAGAX-NODE-GUARD` that drops new
  connections from pod interfaces (`azv+`) to the node; replies to what the
  node opened, such as kubelet probes, pass. To take it off: disable it,
  then on each node `iptables -D INPUT -i azv+ -j SAGAX-NODE-GUARD`,
  `iptables -F SAGAX-NODE-GUARD`, `iptables -X SAGAX-NODE-GUARD` (or let the
  autoscaler replace the nodes).

