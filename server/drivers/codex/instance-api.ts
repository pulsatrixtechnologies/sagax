/** Snapshot, auth and lifecycle surface for a Codex provider instance. */
import { homedir } from "node:os";
import type { ProviderInstance, ProviderSnapshot } from "../../contracts.ts";
import { cliVersionReader, execCli } from "../../procs.ts";
import { serverVersion } from "../../environment.ts";
import { probeCodexSkills } from "../harness-command-probe.ts";
import { reviewCodexPermission } from "../codex-review.ts";
import { CODEX_SIGN_IN_EXPIRED } from "../codex-errors.ts";
import { codexAccountEmail } from "../codex-identity.ts";
import { codexLoginStatus } from "../codex-login.ts";
import { DRIVER_KIND } from "./config.ts";
import { codexAccessLaunch, codexReleaseUpdate } from "./launch-args.ts";

export function buildCodexInstanceApi(bag: Record<string, any>): ProviderInstance {
  const {
    instanceId, input, config, plan, planUnavailable, planAuth, childEnv,
    refreshModels, startupModelRefresh, authentication, loginMark, loginAccepted, loginRejected,
    active, listeners, sendTurn, turnReviewers,
  } = bag;

    const versionOf = cliVersionReader(config.cli);
    const snapshot = async (): Promise<ProviderSnapshot> => {
  if (planUnavailable) return { state: "unavailable", authenticated: false, chatgptPlan: true, reason: planUnavailable, authenticationUnavailableReason: planUnavailable };
  const env = childEnv();
  const probe = await new Promise<ReturnType<typeof versionOf>>((resolve) => {
    execCli(config.cli, ["--version"], { timeout: 8000, env }, (err, stdout) => resolve(versionOf(err, stdout)));
  });
  if (!("version" in probe)) return { state: "unavailable", reason: probe.reason, ...(plan ? { chatgptPlan: true } : {}) };
  const { version } = probe;
  if (planAuth) return { state: "available", version, chatgptPlan: true, billing: "subscription", ...await planAuth.snapshot(), update: await codexReleaseUpdate(version, config.cli),
    ...(bag.planWarning ? { warning: { title: "Check ChatGPT connection", message: bag.planWarning } } : {}) };
  if (config.managed) return { state: "available", version, authenticated: Boolean(input.environment.SAGAX_COMPANY_API_KEY && input.environment.CODEX_HOME), billing: "metered" };
  const previousCliVersion = bag.modelsCliVersion;
  bag.modelsCliVersion = version;
  if (previousCliVersion !== null && previousCliVersion !== version) await refreshModels();
  const authenticated = await codexLoginStatus(config.cli, env) === "signed-in";
  // Signed in as far as the CLI knows, but OpenAI refused it on a real turn.
  if (authenticated && loginRejected()) {
    return { state: "available", version, authenticated: false, reason: CODEX_SIGN_IN_EXPIRED,
      update: await codexReleaseUpdate(version, config.cli), billing: "subscription" };
  }
  // Display identity only, so Settings can say whose ChatGPT account the
  // bots run on; the status command above stays the authority on sign-in.
  const email = authenticated ? await codexAccountEmail(config.cli, env) : null;
  // childEnv drops OPENAI_API_KEY on purpose — turns run on the ChatGPT login
  return {
    state: "available",
    version,
    authenticated,
    ...(email ? { account: { email } } : {}),
    update: await codexReleaseUpdate(version, config.cli),
    billing: "subscription",
  };
    };

    return {
  instanceId,
  driverKind: DRIVER_KIND,
  displayName: input.displayName,
  enabled: input.enabled,
  get models() {
    return bag.models;
  },
  refreshModels,
  ...(startupModelRefresh ? { startupModelRefresh } : {}),
  ...(plan ? { authenticationMethod: "browser-pkce" as const } : {}),
  startAuthentication: async () => {
    if (planUnavailable) throw new Error(planUnavailable);
    if (bag.planSigningOut || bag.disposed) throw new Error("This account is being disconnected. Wait before signing in again.");
    return (planAuth ?? authentication).start();
  },
  getAuthentication: async (flowId) => {
    const result = await (planAuth ?? authentication).get(flowId);
    if (planAuth && result.phase === "succeeded") bag.planWarning = undefined;
    if (planAuth && result.phase === "succeeded" && !bag.models.options.length) await refreshModels();
    return result;
  },
  cancelAuthentication: () => (planAuth ?? authentication).cancel(),
  signOut: async () => {
    if (!planAuth) {
      const mark = loginMark();
      await authentication.signOut();
      loginAccepted(mark);
      return;
    }
    bag.planSigningOut = true;
    bag.planGeneration += 1;
    try {
      const stopped = await Promise.all([...active.values()].map(({ stop }) => stop()));
      if (stopped.some(value => !value)) throw new Error("A ChatGPT task could not stop safely. Stop the task before signing out.");
      bag.models = { default: "", options: [] };
      await planAuth.signOut();
      bag.planWarning = undefined;
    } catch (error) {
      if ((error as { code?: string }).code !== "chatgpt_revocation_unconfirmed") throw error;
      bag.planWarning = (error as Error).message;
    } finally { bag.planSigningOut = false; }
  },
  snapshot,
  reviewPermission: (prompt, signal) => reviewCodexPermission({
    cli: config.cli,
    env: childEnv(),
    prompt,
    signal,
    ...(bag.models.default ? { model: bag.models.default } : {}),
  }),
  adapter: {
    provider: DRIVER_KIND,
    capabilities: {
      sessionModelSwitch: "unsupported",
      withholdsHostTools: true,
      // A guest's turn runs with no environment and the shell off (guestConfined).
      guestTurns: "confined",
      queueing: true,
      computerMcp: true,
      localComputerMcp: true,
      agentsMcp: true,
    customMcp: true,
      phoneMcp: true,
      browserMcp: true,
      dataMcp: true,
      images: true,
      nativeImageInput: true,
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      strictResume: true,
    },
    sendTurn,
    interruptTurn: async (threadId) => {
      await active.get(threadId)?.stop();
    },
    // #1373: a change among Ask, Edits and Auto applies to the running
    // turn's next request when Sagax answers its requests (it reads the
    // live level). Codex's own reviewer keeps answering for Approve for me
    // until the turn ends, so then the harness stops the turn.
    applyApprovalMode: async (threadId, mode) => {
      if (mode !== "ask" && mode !== "edits" && mode !== "auto") return false;
      if (!active.has(threadId)) return true;
      const running = turnReviewers.get(threadId);
      return Boolean(running && running.mode !== "full" && running.sagaxAnswers);
    },
    steer: async (threadId, text, options) => {
      const turn = active.get(threadId);
      return turn?.steer ? await turn.steer(text, options?.steerId) : "refused";
    },
    respondToRequest: async (threadId, requestId, decision) => {
      const turn = active.get(threadId);
      const finish = turn?.asks.get(requestId);
      if (!finish) return "unavailable"; // settled, timed out, or turn gone
      finish(decision.behavior, decision.message, "user");
      return decision.behavior === "allow" ? "allowed-once" : decision.behavior === "answer" ? "answered" : "rejected";
    },
    hasSession: (threadId) => active.has(threadId),
    stopAll: async () => {
      await Promise.all([...active.values()].map(({ stop }) => stop()));
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
  // The skills a turn in this folder can use, from Codex itself; with the
  // speaker's own subscription, from their CODEX_HOME (their user skills).
  listCommands: (scope) => {
    const env = childEnv();
    if (scope.access?.via === "subscription") codexAccessLaunch(env, scope.access);
    return probeCodexSkills({
      cli: config.cli,
      args: ["app-server"],
      env: env as NodeJS.ProcessEnv,
      cwd: scope.cwd ?? homedir(),
      clientVersion: serverVersion(),
    });
  },
  dispose: async () => {
    bag.disposed = true;
    bag.planGeneration += 1;
    await authentication.dispose();
    await planAuth?.dispose();
    await Promise.all([...active.values()].map(({ stop }) => stop()));
    listeners.clear();
  },
    };
}
