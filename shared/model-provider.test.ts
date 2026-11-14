import { describe, expect, it } from "vitest";
import { instanceConfigs, type AppConfig } from "../server/config.ts";
import {
  canonicalModelId,
  COMPUTER_PROVIDER_ID,
  providerOfInstance,
  providerOfModel,
  splitEngine,
  vendorOfDriver,
  XAI_GROUP_LABEL,
} from "./model-provider.ts";

const defaultMap = () => Object.entries(instanceConfigs({} as AppConfig)).map(([instanceId, entry]) => ({
  instanceId,
  driverKind: entry.driver,
  displayName: entry.displayName ?? instanceId,
}));

describe("one provider per instance (#4329)", () => {
  it("puts every instance of the default map in exactly one provider, or splits its rows by vendor", () => {
    const map = defaultMap();
    expect(map.length).toBeGreaterThan(10);
    for (const instance of map) {
      const provider = providerOfInstance(instance);
      if (provider === null) {
        // pi: no vendor of its own, each row lands under the vendor before its slash
        expect(splitEngine(instance.driverKind)).toBe(true);
        expect(providerOfModel(instance, { id: "anthropic/claude-opus-5" }).id).toBe("anthropic");
        continue;
      }
      expect(provider.id).toBeTruthy();
      expect(provider.label).toBeTruthy();
      // the same answer every time: one provider
      expect(providerOfInstance(instance)).toEqual(provider);
    }
  });

  it("makes OpenAI's two subscription instances and its key one provider, never named after the tool", () => {
    const codex = providerOfInstance({ instanceId: "codex", driverKind: "codex", displayName: "Codex" });
    const plan = providerOfInstance({ instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" });
    const key = providerOfInstance({ instanceId: "openai", driverKind: "openai-compat", displayName: "OpenAI" });
    expect(codex).toEqual({ id: "openai", label: "OpenAI", kind: "vendor" });
    expect(plan).toEqual(codex);
    expect(key).toEqual(codex);
  });

  it("groups the xAI tool, the xAI key and pi's xAI rows under the one xAI group label", () => {
    expect(XAI_GROUP_LABEL).toBe("SpaceXAI");
    const tool = providerOfInstance({ instanceId: "grok", driverKind: "grokAgent", displayName: "Grok" });
    const key = providerOfInstance({ instanceId: "xaiApi", driverKind: "grok", displayName: "xAI" });
    const pi = providerOfModel({ instanceId: "pi", driverKind: "piAgent", displayName: "pi" }, { id: "xai/grok-5" });
    expect(tool).toEqual({ id: "xai", label: "SpaceXAI", kind: "vendor" });
    expect(key).toEqual(tool);
    expect(pi).toEqual(tool);
  });

  it("puts Claude's sign-in and Claude's key under Claude", () => {
    expect(providerOfInstance({ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude" })?.label).toBe("Claude");
    expect(providerOfInstance({ instanceId: "claudeApi", driverKind: "claudeAgent", displayName: "Claude (API key)" })?.id).toBe("anthropic");
  });

  it("lands pi and OpenCode rows under the vendor before the slash, and OpenCode's own models under OpenCode", () => {
    const pi = { instanceId: "pi", driverKind: "piAgent", displayName: "pi" };
    const opencode = { instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode" };
    expect(providerOfModel(pi, { id: "anthropic/claude-opus-5" }).id).toBe("anthropic");
    expect(providerOfModel(pi, { id: "moonshotai/kimi-k3" }).id).toBe("moonshot");
    expect(providerOfModel(opencode, { id: "openai/gpt-6" }).id).toBe("openai");
    expect(providerOfModel(opencode, { id: "openrouter/anthropic/claude-opus-5" }).id).toBe("openrouter");
    expect(providerOfModel(opencode, { id: "opencode/big-pickle" })).toEqual({ id: "opencode", label: "OpenCode", kind: "vendor" });
    expect(providerOfModel(opencode, { id: "opencode-go/kimi-k3" }).id).toBe("opencode");
  });

  it("names a server added by address by the person's name for it, and this computer's rows This computer", () => {
    expect(providerOfInstance({ instanceId: "personal-1", driverKind: "openai-compat", displayName: "Home server", providerAccount: { provider: "compat:lab", serverId: "lab" } }))
      .toEqual({ id: "server:lab", label: "Home server", kind: "server" });
    expect(providerOfInstance({ instanceId: "compat-lab", driverKind: "openai-compat", displayName: "Lab" })).toEqual({ id: "server:compat-lab", label: "Lab", kind: "server" });
    expect(providerOfModel({ instanceId: "pi", driverKind: "piAgent", displayName: "pi" }, { id: "px-own-lab/qwen3", custom: true, server: "Lab box" }))
      .toEqual({ id: "server:px-own-lab", label: "Lab box", kind: "server" });
    expect(providerOfModel({ instanceId: "codex", driverKind: "codex", displayName: "Codex" }, { id: "deskabc::qwen3", local: true }).id).toBe(COMPUTER_PROVIDER_ID);
  });

  it("gives a canonical id that matches across engines, and nothing more", () => {
    const claude = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude" };
    const pi = { instanceId: "pi", driverKind: "piAgent", displayName: "pi" };
    expect(canonicalModelId(claude, { id: "claude-opus-5" })).toBe(canonicalModelId(pi, { id: "anthropic/claude-opus-5" }));
    // a different spelling is a different model: never guessed
    expect(canonicalModelId(claude, { id: "claude-opus-5-20261101" })).not.toBe(canonicalModelId(pi, { id: "anthropic/claude-opus-5" }));
    // an OpenRouter id keeps its own vendor path
    expect(canonicalModelId({ instanceId: "openrouter", driverKind: "openai-compat", displayName: "OpenRouter" }, { id: "anthropic/claude-opus-5" })).toBe("anthropic/claude-opus-5");
    // this computer's model keeps its host
    expect(canonicalModelId(claude, { id: "deskabc::qwen3", local: true })).toBe("deskabc::qwen3");
  });

  it("knows the vendor of a one-vendor driver only", () => {
    expect(vendorOfDriver("claudeAgent")).toBe("anthropic");
    expect(vendorOfDriver("codex")).toBe("openai");
    expect(vendorOfDriver("antigravityAgent")).toBe("google");
    expect(vendorOfDriver("piAgent")).toBeUndefined();
    expect(vendorOfDriver("openai-compat")).toBeUndefined();
  });
});
