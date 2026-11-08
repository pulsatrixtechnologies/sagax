// The isolated environment of a bot computer (#2727): a light Linux VM the
// bot provisions on the chosen host, through the same remote channel as its
// shell calls. The engine follows the host's OS: KVM/libvirt (virsh) on Linux
// and unRAID, tart or lima on macOS, Hyper-V on Windows. Provisioning runs in
// the background on the host and writes "STEP:" lines to a log the status
// call reads, so no call waits past the remote channel's time limit. The VM
// installs the remote agent with a fresh install code, so it enrolls as a
// computer of its own (a sub-computer of the host).
import type { BotComputerHostOs, BotComputerVmEngine } from "../../shared/bot-computer-host.ts";

/** Debian 12 cloud image (light, cloud-init). */
export const LINUX_IMAGE_URL = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2";
export const TART_IMAGE = "ghcr.io/cirruslabs/ubuntu:latest";
export const LIMA_TEMPLATE = "template://debian-12";
/** The Hyper-V disk: the same Debian image, as a VHDX. */
export const HYPERV_IMAGE_URL = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.raw";
/** Where the agent installer comes from inside the VM (overridable). */
export const AGENT_INSTALLER_URL = process.env.SAGAX_REMOTE_ACCESS_INSTALLER_URL?.trim()
  || "https://github.com/pulsatrixtechnologies/sagax-remote-access/releases/latest/download/install.sh";

export interface VmSpec {
  name: string;
  cpus: number;
  memoryMb: number;
  diskGb: number;
  /** libvirt: the bridge the VM joins (unRAID: br0). */
  bridge: string;
  /** libvirt: the folder that holds the VM's disks (unRAID: /mnt/user/domains). */
  poolDir: string;
  /** The one line that installs and enrolls the remote agent in the VM. */
  agentInstall: string;
}

export const DEFAULT_VM: Omit<VmSpec, "name" | "agentInstall"> = {
  cpus: 2,
  memoryMb: 4096,
  diskGb: 20,
  bridge: "br0",
  poolDir: "/mnt/user/domains",
};

/** A VM name from the bot's name: lower case, letters, digits and dashes. */
export function vmName(botName: string): string {
  const slug = botName.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 32).replace(/^-|-$/g, "");
  return `sagax-${slug || "bot"}`;
}

export function safeVmName(name: string): string | null {
  return /^sagax-[a-z0-9-]{1,40}$/.test(name) ? name : null;
}

const LOG = (name: string) => `/tmp/${name}.provision.log`;
const WIN_LOG = (name: string) => `$env:TEMP\\${name}.provision.log`;

function sh(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function ps(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** One command that prints the engine this host can use, or "none". */
export function detectEngineCommand(os: BotComputerHostOs): string {
  if (os === "linux") {
    return "if command -v virsh >/dev/null 2>&1 && virsh -c qemu:///system version >/dev/null 2>&1; then echo libvirt; else echo none; fi";
  }
  if (os === "macos") {
    return "if command -v tart >/dev/null 2>&1; then echo tart; elif command -v limactl >/dev/null 2>&1; then echo lima; else echo none; fi";
  }
  return "if ((Get-Command New-VM -ErrorAction SilentlyContinue) -and ((Get-Service vmms -ErrorAction SilentlyContinue).Status -eq 'Running')) { 'hyperv' } else { 'none' }";
}

export function parseEngine(stdout: string): BotComputerVmEngine | null {
  const word = stdout.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  return word === "libvirt" || word === "tart" || word === "lima" || word === "hyperv" ? word : null;
}

/** cloud-init user data: a user for the agent, then the agent itself. */
export function cloudInitUserData(spec: Pick<VmSpec, "name" | "agentInstall">): string {
  return [
    "#cloud-config",
    `hostname: ${spec.name}`,
    "package_update: true",
    "packages: [curl, ca-certificates]",
    "runcmd:",
    `  - [sh, -c, ${JSON.stringify(`curl -fsSL ${AGENT_INSTALLER_URL} | sh && ${spec.agentInstall}`)}]`,
    "",
  ].join("\n");
}

/** The libvirt domain: KVM, virtio disk and seed, the bridge, no display. */
export function libvirtDomainXml(spec: VmSpec): string {
  const dir = `${spec.poolDir}/${spec.name}`;
  return `<domain type='kvm'><name>${spec.name}</name><memory unit='MiB'>${spec.memoryMb}</memory><vcpu>${spec.cpus}</vcpu>`
    + "<os><type arch='x86_64' machine='q35'>hvm</type><boot dev='hd'/></os><features><acpi/><apic/></features><cpu mode='host-passthrough'/>"
    + `<devices><disk type='file' device='disk'><driver name='qemu' type='qcow2'/><source file='${dir}/disk.qcow2'/><target dev='vda' bus='virtio'/></disk>`
    + `<disk type='file' device='cdrom'><driver name='qemu' type='raw'/><source file='${dir}/seed.iso'/><target dev='sda' bus='sata'/><readonly/></disk>`
    + `<interface type='bridge'><source bridge='${spec.bridge}'/><model type='virtio'/></interface>`
    + "<serial type='pty'/><console type='pty'/><channel type='unix'><target type='virtio' name='org.qemu.guest_agent.0'/></channel></devices></domain>";
}

/** The provisioning script for the engine, started in the background on the host. */
export function provisionCommand(engine: BotComputerVmEngine, spec: VmSpec): string {
  const userData = cloudInitUserData(spec);
  if (engine === "libvirt") {
    const dir = `${spec.poolDir}/${spec.name}`;
    const script = [
      "set -e",
      `mkdir -p ${sh(dir)} && cd ${sh(dir)}`,
      "echo 'STEP: Downloading the Linux image'",
      `[ -f base.qcow2 ] || curl -fsSL -o base.qcow2 ${sh(LINUX_IMAGE_URL)}`,
      "echo 'STEP: Creating the disk'",
      `qemu-img create -f qcow2 -F qcow2 -b base.qcow2 disk.qcow2 ${spec.diskGb}G`,
      "echo 'STEP: Writing cloud-init'",
      `printf '%s\\n' 'instance-id: ${spec.name}' 'local-hostname: ${spec.name}' > meta-data`,
      `printf '%s' ${sh(userData)} > user-data`,
      "if command -v cloud-localds >/dev/null 2>&1; then cloud-localds seed.iso user-data meta-data;"
        + " elif command -v genisoimage >/dev/null 2>&1; then genisoimage -quiet -output seed.iso -volid cidata -joliet -rock user-data meta-data;"
        + " elif command -v mkisofs >/dev/null 2>&1; then mkisofs -quiet -output seed.iso -volid cidata -joliet -rock user-data meta-data;"
        + " elif command -v xorriso >/dev/null 2>&1; then xorriso -as mkisofs -quiet -output seed.iso -volid cidata -joliet -rock user-data meta-data;"
        + " else echo 'FAILED: no ISO tool (cloud-localds, genisoimage, mkisofs or xorriso) on this host'; exit 1; fi",
      "echo 'STEP: Starting the VM'",
      `printf '%s' ${sh(libvirtDomainXml(spec))} > domain.xml`,
      "virsh -c qemu:///system define domain.xml >/dev/null",
      `virsh -c qemu:///system start ${sh(spec.name)} >/dev/null`,
      "echo 'STEP: Installing the remote agent'",
      "echo 'DONE'",
    ].join("\n");
    return `nohup sh -c ${sh(`(${script}) || echo FAILED`)} > ${LOG(spec.name)} 2>&1 &\necho started`;
  }
  if (engine === "tart") {
    const script = [
      "set -e",
      "echo 'STEP: Downloading the Linux image'",
      `tart clone ${sh(TART_IMAGE)} ${sh(spec.name)}`,
      `tart set ${sh(spec.name)} --cpu ${spec.cpus} --memory ${spec.memoryMb} --disk-size ${spec.diskGb}`,
      "echo 'STEP: Starting the VM'",
      `(tart run --no-graphics ${sh(spec.name)} >/dev/null 2>&1 &)`,
      "sleep 40",
      "echo 'STEP: Installing the remote agent'",
      `tart exec ${sh(spec.name)} sh -c ${sh(`sudo hostname ${spec.name}; curl -fsSL ${AGENT_INSTALLER_URL} | sudo sh && sudo ${spec.agentInstall}`)}`,
      "echo 'DONE'",
    ].join("\n");
    return `nohup sh -c ${sh(`(${script}) || echo FAILED`)} > ${LOG(spec.name)} 2>&1 &\necho started`;
  }
  if (engine === "lima") {
    const script = [
      "set -e",
      "echo 'STEP: Downloading the Linux image'",
      `limactl create --tty=false --name=${sh(spec.name)} --cpus=${spec.cpus} --memory=${Math.max(1, Math.round(spec.memoryMb / 1024))} --disk=${spec.diskGb} ${sh(LIMA_TEMPLATE)}`,
      "echo 'STEP: Starting the VM'",
      `limactl start --tty=false ${sh(spec.name)}`,
      "echo 'STEP: Installing the remote agent'",
      `limactl shell ${sh(spec.name)} sh -c ${sh(`sudo hostname ${spec.name}; curl -fsSL ${AGENT_INSTALLER_URL} | sudo sh && sudo ${spec.agentInstall}`)}`,
      "echo 'DONE'",
    ].join("\n");
    return `nohup sh -c ${sh(`(${script}) || echo FAILED`)} > ${LOG(spec.name)} 2>&1 &\necho started`;
  }
  // Hyper-V: the Debian raw disk converted to VHDX by qemu-img, a NoCloud
  // seed ISO made by oscdimg (Windows ADK), the Default Switch. Either tool
  // missing stops with one plain sentence in the log.
  const dir = `$env:PUBLIC\\Documents\\Hyper-V\\${spec.name}`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "if (-not (Get-Command qemu-img -ErrorAction SilentlyContinue)) { throw 'qemu-img is not on this host (it turns the Linux image into a Hyper-V disk)' }",
    "if (-not (Get-Command oscdimg -ErrorAction SilentlyContinue)) { throw 'oscdimg (Windows ADK) is not on this host (it writes the cloud-init disk)' }",
    `$dir = "${dir}"; New-Item -ItemType Directory -Force -Path (Join-Path $dir 'seed') | Out-Null; Set-Location $dir`,
    "'STEP: Downloading the Linux image'",
    `if (-not (Test-Path base.raw)) { Invoke-WebRequest -UseBasicParsing -Uri ${ps(HYPERV_IMAGE_URL)} -OutFile base.raw }`,
    "'STEP: Creating the disk'",
    "qemu-img convert -O vhdx -o subformat=dynamic base.raw disk.vhdx",
    `Resize-VHD -Path disk.vhdx -SizeBytes ${spec.diskGb}GB`,
    "'STEP: Writing cloud-init'",
    `Set-Content -Path seed\\user-data -Value ${ps(userData)} -NoNewline; Set-Content -Path seed\\meta-data -Value ${ps(`instance-id: ${spec.name}\nlocal-hostname: ${spec.name}\n`)} -NoNewline`,
    "oscdimg -j2 -lcidata seed seed.iso | Out-Null",
    "'STEP: Starting the VM'",
    `New-VM -Name ${ps(spec.name)} -Generation 2 -MemoryStartupBytes ${spec.memoryMb}MB -VHDPath disk.vhdx -SwitchName 'Default Switch' | Out-Null`,
    `Set-VMProcessor -VMName ${ps(spec.name)} -Count ${spec.cpus}; Set-VMFirmware -VMName ${ps(spec.name)} -EnableSecureBoot Off`,
    `Add-VMDvdDrive -VMName ${ps(spec.name)} -Path (Join-Path $dir 'seed.iso')`,
    `Start-VM -Name ${ps(spec.name)}`,
    "'STEP: Installing the remote agent'",
    "'DONE'",
  ].join("; ");
  return `Start-Job -ScriptBlock { try { & { ${script} } *> "${WIN_LOG(spec.name)}" } catch { "FAILED: $_" | Out-File -Append "${WIN_LOG(spec.name)}" } } | Out-Null; 'started'`;
}

/** Where provisioning stands: the last log lines and the VM's own state. */
export function statusCommand(engine: BotComputerVmEngine, name: string): string {
  if (engine === "libvirt") return `tail -n 3 ${LOG(name)} 2>/dev/null; echo "STATE: $(virsh -c qemu:///system domstate ${sh(name)} 2>/dev/null || echo absent)"`;
  if (engine === "tart") return `tail -n 3 ${LOG(name)} 2>/dev/null; echo "STATE: $(tart list 2>/dev/null | awk -v n=${sh(name)} '$2==n {print $NF}' | head -n1 || echo absent)"`;
  if (engine === "lima") return `tail -n 3 ${LOG(name)} 2>/dev/null; echo "STATE: $(limactl list --format '{{.Status}}' ${sh(name)} 2>/dev/null || echo absent)"`;
  return `Get-Content -Tail 3 "${WIN_LOG(name)}" -ErrorAction SilentlyContinue; "STATE: $((Get-VM -Name ${ps(name)} -ErrorAction SilentlyContinue).State)"`;
}

export function deleteCommand(engine: BotComputerVmEngine, name: string, poolDir = DEFAULT_VM.poolDir): string {
  if (engine === "libvirt") {
    return `virsh -c qemu:///system destroy ${sh(name)} >/dev/null 2>&1; virsh -c qemu:///system undefine ${sh(name)} --nvram >/dev/null 2>&1 || virsh -c qemu:///system undefine ${sh(name)} >/dev/null 2>&1; rm -f ${sh(`${poolDir}/${name}`)}/disk.qcow2 ${sh(`${poolDir}/${name}`)}/seed.iso ${LOG(name)}; echo deleted`;
  }
  if (engine === "tart") return `tart stop ${sh(name)} >/dev/null 2>&1; tart delete ${sh(name)} >/dev/null 2>&1; rm -f ${LOG(name)}; echo deleted`;
  if (engine === "lima") return `limactl stop -f ${sh(name)} >/dev/null 2>&1; limactl delete -f ${sh(name)} >/dev/null 2>&1; rm -f ${LOG(name)}; echo deleted`;
  return `Stop-VM -Name ${ps(name)} -TurnOff -Force -ErrorAction SilentlyContinue; Remove-VM -Name ${ps(name)} -Force -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force "$env:PUBLIC\\Documents\\Hyper-V\\${name}" -ErrorAction SilentlyContinue; 'deleted'`;
}

/** The status answer read as one step line and a state. */
export function parseVmStatus(stdout: string): { step: string | null; failed: string | null; done: boolean; running: boolean; absent: boolean } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const stepLine = [...lines].reverse().find((line) => line.startsWith("STEP:"));
  const failedLine = lines.find((line) => line.startsWith("FAILED"));
  const state = (lines.find((line) => line.startsWith("STATE:")) ?? "").slice(6).trim().toLowerCase();
  return {
    step: stepLine ? stepLine.slice(5).trim() : null,
    failed: failedLine ? (failedLine.replace(/^FAILED:?\s*/, "") || "Provisioning stopped on the host.") : null,
    done: lines.includes("DONE"),
    running: state === "running",
    absent: state === "" || state === "absent",
  };
}
