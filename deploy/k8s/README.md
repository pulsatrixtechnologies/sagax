# Sandboxes on Kubernetes

Sommaire. Ce dossier est l'option 3 de l'audit du 12 octobre 2026 : un
pool portable de bacs à sable, hors de la VM de production, qui peut revenir à zéro
nœud la nuit et garder un nœud chaud le jour. Le même dossier tient le
provisionneur Kubernetes (`provisioner/`), le pool (`sandboxes/`), le chart
Helm et les modules OpenTofu. `SANDBOX_BACKEND=kubernetes` lance ce
provisionneur. Le service compose de production reste sur Docker. Sagax choisit
lequel appeler (`docs/ops/sandboxes/cutover-rollback.md`).

English follows.

## What this is

A person's server environment is still one Pod or one container per person,
created by `sagax-sandboxd` (`docs/user-sandbox.md`). This tree is that
Kubernetes side: the provisioner manifests, the pool, the chart and the
modules. Nothing here mounts a Docker socket. The Docker provisioner stays
the compose service. Sagax routes between them
(`docs/ops/sandboxes/cutover-rollback.md`).

One tree, four layers. The provisioner process is real: `SANDBOX_BACKEND=kubernetes` runs it (`server/sandboxd-k8s/sandboxd-k8s.ts`). It does not exit.

| Layer | Path | Job |
|---|---|---|
| Provisioner | `provisioner/` | Namespace, Role, NetworkPolicies, quota and the Deployment the Kubernetes `sagax-sandboxd` runs from. |
| Pool | `sandboxes/` | Weekday warm node, KEDA, autoscaler values, Azure adapter, alerts, Velero schedule. |
| Chart | `helm/sandboxes/` | Namespaces, the `sagax-sandboxd` ServiceAccount, NetworkPolicies, a StorageClass, admission, a warm node, Velero backups. |
| Modules | `tofu/` | A cloud-agnostic pool description (`tofu/core`) and adapters that can create a cluster. Every adapter defaults to off. |

`SOC2.md` maps each piece to the AICPA Trust Services Criteria it can
evidence. The mapping is evidence the platform can produce. It is not an
audit report.

## Option 3, as built

The production VM (`<VM_SIZE>`, arm64, `<REGION>`) stays the home of
Pulsabot. Sandboxes move to a pool that speaks the Kubernetes API, so the
same chart runs on k3s, AKS, EKS or LKE.

- One warm sandbox node from 07:00 to 19:00 `America/Toronto`, none at
  night. The chart holds that node with a pause pod. The autoscaler minimum
  stays 0, so the node can leave after the scale-down delay. A running
  sandbox is marked unsafe to evict by the future adapter (`contract`
  ConfigMap); this chart does not create those pods.
- The control plane, or the k3s server, does not scale to zero. A CronJob
  has to run somewhere, and AKS refuses a system pool of zero.
- The sandbox pool is arm64, 4 vCPU, 16 GiB: `<VM_SIZE>` on AKS,
  `t4g.xlarge` on AWS, `g6-standard-8` on Linode, 4 vCPU and 16 GiB on
  Proxmox. Default maximum is 4 nodes. `<REGION>`'s 10 vCPU quota has
  to be raised before that maximum is real.
- Images are multi-arch digests. Secrets are not in this tree: the chart
  does not render a Secret, and the k3s join token and etcd key are read
  on the host.

## Chart

```sh
helm lint deploy/k8s/helm/sandboxes
helm template sandboxes deploy/k8s/helm/sandboxes
```

The server itself has a separate chart at `deploy/k8s/helm/server`. It installs the Sagax server image, not these sandboxes. Rendering it does not apply it. See that chart's README.

## Server chart

```sh
helm lint deploy/k8s/helm/server
helm template sagax deploy/k8s/helm/server
```

Overlays are deep-merged, not replacements:

- `values.yaml` is the portable default (Longhorn, encryption required).
- `values-azure.yaml` switches the StorageClass to `disk.csi.azure.com` and
  names a disk encryption set. The placeholder
  `REPLACE_WITH_DISK_ENCRYPTION_SET_ID` has to be replaced with the set the
  Azure module outputs.
- The Azure kustomize adapter (`sandboxes/adapters/azure`) sets the
  provisioner's `SAGAX_SANDBOX_K8S_DENY_HOSTS` to
  `REPLACE_WITH_API_SERVER_FQDN`: replace it with the module output
  `api_server_fqdn`. Left as is, the provisioner refuses to start.
- `values-k3s.yaml` turns on the named-admin ClusterRoleBinding.

What the chart renders:

| Object | Rule |
|---|---|
| `sandboxes`, `sandbox-system` | Pod Security `restricted`. |
| ServiceAccount `sagax-sandboxd` | A Role in the sandbox namespace only: pods (including exec and log) and persistent volume claims. No secrets, no nodes, no cluster role. |
| NetworkPolicy | Default deny. Sandbox egress is DNS plus the public internet, with the private, link-local, metadata and Azure WireServer ranges removed. No traffic between sandboxes. |
| StorageClass | Encrypted, `Retain`, `WaitForFirstConsumer`. The chart refuses to render unless encryption is set. |
| Cloud agent runs (`runs.enabled`, off) | Namespace `sandbox-runs` (Pod Security `restricted`), `sagax-run-workload` without a token, a Role without exec, logs or Secret reads, quota `sagax-run-quota`, default deny, admission `sandboxes-runs` (allowlisted digests only, runs pool). See `docs/sandbox-kubernetes.md`, "Cloud agent runs". |
| Warm node | Pause image by digest, on nodes labeled `sagax.io/pool=sandboxes` and tainted `sagax.io/sandboxes=true:NoSchedule`. CronJobs scale it to 1 at 07:00 and to 0 at 19:00. |
| Admission | In-tree policy: Pulsatrix images or a digest allowlist, no `:latest`, no privileged pod, no host path, no host network. Placement policy: sandbox pods only on the sandbox pool. Kyverno policy: keyless GitHub Actions signature and a vulnerability attestation with zero Critical and zero High. Kyverno itself is installed separately. |
| Backups | Velero `Schedule` and `BackupStorageLocation`. The destination provider must differ from the cluster's provider. The credential Secret is created by the operator. Velero itself is installed separately. |
| Audit policy | ConfigMap copied from `audit/policy.yaml`. AKS uses diagnostic settings instead of this file on the apiserver; the ConfigMap remains the record of what was asked. |

`provisioner.enabled` is a flag for the future adapter. The chart has no
Deployment for today's `sagax-sandboxd`, because that process needs a
Docker socket.

## OpenTofu

```sh
cd deploy/k8s/tofu/stacks/k3s   # or stacks/azure
tofu init -backend=false
tofu validate
```

Do not plan or apply these stacks from a workstation that has cloud
credentials unless you intend to create the cluster. The examples keep
`enabled = false`, so a plan would change nothing.

| Module | When it is on |
|---|---|
| `tofu/core` | Always. Pool shape, schedule, retention, and the security object every adapter must honour. |
| `tofu/adapters/k3s` | Cloud-init for a k3s server and workers: audit policy, encryption config check, OIDC, anonymous auth off. The k3s binary must already be at `/usr/local/bin/k3s`. |
| `tofu/adapters/k3s-proxmox` | VMs cloned from a template. Disk encryption is recorded as `luks`, `zfs` or `ceph`. |
| `tofu/adapters/k3s-linode` | Linode instances with disk encryption enabled. |
| `tofu/adapters/k3s-aws` | Launch template and an autoscaling group. Root volumes encrypted, IMDSv2 required, minimum and desired equal to the night count (0). |
| `tofu/adapters/azure` | Optional. Free-tier AKS, Azure CNI overlay, system pool that stays up, sandbox pool that can scale to zero, customer-managed keys, audit account. |

### SOC 2 pieces in the modules

`SOC2.md` is the control list. Short form:

| Requirement | AKS | k3s |
|---|---|---|
| API audit, immutable retention (365 days) | Diagnostic logs to a GRS account with an immutability policy and a customer-managed key. Locked only when `production` and `lock_audit_immutability` are both set. | Audit policy on the apiserver. A daily ship unit refuses to start until `/etc/sagax/audit-sink.env` exists. Object lock on the bucket is the operator's. |
| Encryption at rest | One disk encryption set on the cluster, covering node OS disks and volumes. etcd secrets through Key Vault KMS. | `encryption-provider-config`. A file that still says `REPLACE_ON_HOST` refuses to boot. Node disks: LUKS, ZFS or Ceph on Proxmox, Linode disk encryption, encrypted EBS on AWS. |
| Named admins with MFA | Entra ID groups only, `local_account_disabled`. `entra_mfa_policy_id` is required and is not created here. | OIDC issuer, client and group claim. `oidc_mfa_enforced` must be true: that is the operator's attestation that the issuer requires MFA. |
| No shared or local admin | No local accounts. Role assignments are groups. The chart refuses `system:masters`, `system:anonymous`, `admin` and `root`. | Anonymous auth off. Kubeconfig mode `0600`. The node certificate stays on the server; it is a process credential. |
| Image signing and scan | The chart's admission policies, on every cluster. | Same chart. |
| Volume backups | The chart's Velero schedule. `productionProvider` is `azure` in the Azure overlay. | The chart's Velero schedule. Default production provider is `k3s`, destination `minio`. |

## What is not included

- A Kubernetes client inside `sagax-sandboxd`. The provisioner still uses
  the Docker socket on the VM.
- Installing Kyverno, Velero, Longhorn, or a container storage interface.
- A Conditional Access policy. Creating one from this module could lock the
  tenant.
- A join token, an etcd encryption key, a Velero credential, or a cloud
  secret in Terraform state or cloud-init.
- Applying a stack, installing the chart on a live cluster, or touching
  `release/next`.

## Validate

`scripts/validate.sh` lints and renders the chart (default, Azure, k3s),
renders the Azure kustomize adapter (`kubectl kustomize`), checks the audit
policy copies match, and runs `tofu validate` on both stacks. It does not call a cloud API.
