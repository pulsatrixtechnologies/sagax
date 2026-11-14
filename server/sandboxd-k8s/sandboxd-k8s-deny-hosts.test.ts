import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { denyHostsFromEnv, resolveDenyHosts } from "./sandboxd-k8s-deny-hosts.ts";

describe("the cluster API is denied to every sandbox", () => {
  it("reads the hosts, IPv4 or names, and refuses anything else", () => {
    expect(denyHostsFromEnv({})).toEqual([]);
    expect(denyHostsFromEnv({ SAGAX_SANDBOX_K8S_DENY_HOSTS: "API.Example.test, 203.0.113.10" }))
      .toEqual(["api.example.test", "203.0.113.10"]);
    expect(() => denyHostsFromEnv({ SAGAX_SANDBOX_K8S_DENY_HOSTS: "http://x" })).toThrow(/not a host name/);
  });

  it("never takes the ClusterIP an AKS pod is handed for the API", () => {
    // Issue 503: on AKS, KUBERNETES_SERVICE_HOST is the `kubernetes` Service
    // ClusterIP, translated before the policy is evaluated: denying it as a
    // /32 denies nothing, so it must not stand in for the API FQDN.
    expect(denyHostsFromEnv({ KUBERNETES_SERVICE_HOST: "10.215.0.1", KUBERNETES_SERVICE_PORT: "443" })).toEqual([]);
    expect(denyHostsFromEnv({ SAGAX_SANDBOX_K8S_DENY_HOSTS: "", KUBERNETES_SERVICE_HOST: "10.215.0.1" })).toEqual([]);
  });

  it("the Azure adapter never runs the provisioner with an empty deny list", () => {
    // Issue 503: a rebuild from the Azure adapter carries the API FQDN, or a
    // placeholder the provisioner refuses at start, never an empty value.
    const patch = readFileSync(new URL("../../deploy/k8s/sandboxes/adapters/azure/sandboxd-deny-hosts.yaml", import.meta.url), "utf8");
    const value = /- name: SAGAX_SANDBOX_K8S_DENY_HOSTS\s*\n\s*value: "?([^"\n]*)"?/.exec(patch)?.[1]?.trim() ?? "";
    expect(value).toBe("REPLACE_WITH_API_SERVER_FQDN");
    expect(() => denyHostsFromEnv({ SAGAX_SANDBOX_K8S_DENY_HOSTS: value, KUBERNETES_SERVICE_HOST: "10.215.0.1" })).toThrow(/not a host name/);
    const kustomization = readFileSync(new URL("../../deploy/k8s/sandboxes/adapters/azure/kustomization.yaml", import.meta.url), "utf8");
    expect(kustomization).toMatch(/- path: sandboxd-deny-hosts\.yaml/);
  });

  it("resolves each host to /32s and fails on a host with no address", async () => {
    const lookup = async (host: string) => (host === "api.test" ? ["203.0.113.10", "203.0.113.11", "::1"] : []);
    expect(await resolveDenyHosts(["api.test", "1.2.3.4"], async (host) => (host === "1.2.3.4" ? ["1.2.3.4"] : lookup(host))))
      .toEqual(["1.2.3.4/32", "203.0.113.10/32", "203.0.113.11/32"]);
    await expect(resolveDenyHosts(["gone.test"], lookup)).rejects.toThrow(/no IPv4/);
  });
});
