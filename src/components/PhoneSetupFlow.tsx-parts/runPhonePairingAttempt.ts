import { t } from "@/lib/i18n";
import type { CompanionAccountState } from "../../types/ogb";
import {
  companionPairingRoute,
  companionPairingRoutePin,
} from "../../lib/companion-pairing";
import {
  closePhonePairingIfOwned,
  companionPairingOpenFailure,
  companionStartFailure,
  completePhonePairingAttempt,
  keepPhonePairingIfCurrent,
  normalizePhoneSetupActionError,
  phonePairingGate,
  preparePhonePairingRoute,
  releasePhonePairingAttempt,
  type PhonePairingAttemptLock,
  type PhonePairingAttemptQueue,
  type PhoneSetupEvent,
} from "../../lib/phone-setup";
import {
  companionBridge,
  directPairingUnavailable,
  mutateCompanionBridgeState,
  protectedPairingUnavailable,
} from "./bridges";
import type {
  CompanionState,
  CompanionStateMutationEpoch,
  OwnedCompanionPairingRoutePin,
  PhonePairingRequest,
} from "./types";
import type { Dispatch, SetStateAction } from "react";

export type RunPhonePairingAttemptDeps = {
  mounted: { current: boolean };
  setupGeneration: { current: number };
  companionMutationEpoch: CompanionStateMutationEpoch;
  pairingUiOwner: { current: PhonePairingAttemptLock };
  pairingAttemptQueue: { current: PhonePairingAttemptQueue<PhonePairingRequest> };
  pairingRoutePinRef: { current: OwnedCompanionPairingRoutePin | null };
  runPairingAttemptRef: { current: (request: PhonePairingRequest) => Promise<void> };
  account: CompanionAccountState | null;
  state: CompanionState | null;
  publishPairingRoutePin: (pin: OwnedCompanionPairingRoutePin | null) => void;
  setState: Dispatch<SetStateAction<CompanionState | null>>;
  setError: (value: string | null) => void;
  setProvisioning: (value: boolean) => void;
  setSetupTimedOut: (value: boolean) => void;
  setPairingBusy: (value: boolean) => void;
  dispatchFlow: Dispatch<PhoneSetupEvent>;
};

export async function runPhonePairingAttempt(
  deps: RunPhonePairingAttemptDeps,
  { routeMode, accountOverride, generation }: PhonePairingRequest,
): Promise<void> {
  const finishAttempt = () => {
    if (releasePhonePairingAttempt(deps.pairingUiOwner.current, generation) && deps.mounted.current) {
      deps.setPairingBusy(false);
    }
    const next = completePhonePairingAttempt(deps.pairingAttemptQueue.current, generation);
    if (next) void deps.runPairingAttemptRef.current(next);
  };
  const isCurrent = () => deps.mounted.current && deps.setupGeneration.current === generation;
  if (!isCurrent()) {
    finishAttempt();
    return;
  }
  const companion = companionBridge();
  if (!companion) {
    if (deps.mounted.current && deps.setupGeneration.current === generation) {
      deps.setError(t("phone.error.desktopOnly"));
    }
    finishAttempt();
    return;
  }
  const staleAttemptMayClose = () => {
    const activePin = deps.pairingRoutePinRef.current;
    return !activePin || activePin.generation === generation;
  };
  const previousPin = deps.pairingRoutePinRef.current;
  if (previousPin && previousPin.generation !== generation) {
    deps.publishPairingRoutePin(null);
    deps.setState((current) => current?.pairing?.token === previousPin.token
      ? { ...current, pairing: null }
      : current);
  }
  deps.setError(null);
  try {
    const started = await preparePhonePairingRoute(
      routeMode,
      Boolean(deps.state?.enabled),
      {
        read: () => companion.state(),
        start: () => mutateCompanionBridgeState(
          deps.companionMutationEpoch,
          () => companion.start(),
        ),
        refreshTailscale: () => mutateCompanionBridgeState(
          deps.companionMutationEpoch,
          () => companion.refreshTailscale(),
        ),
        shouldContinue: isCurrent,
      },
    );
    if (!isCurrent()) return;
    deps.setState(started);
    const startFailure = companionStartFailure(started);
    if (startFailure) {
      deps.setProvisioning(false);
      deps.setError(startFailure);
      deps.dispatchFlow({ type: "reset" });
      return;
    }
    const explicitRoute = routeMode !== "automatic";
    const gate = phonePairingGate(accountOverride ?? deps.account, started, explicitRoute);
    if (gate !== "open") {
      deps.setProvisioning(gate === "wait" || gate === "start");
      return;
    }
    if (explicitRoute && !companionPairingRoute(started, routeMode)) {
      deps.setProvisioning(false);
      deps.setError(routeMode === "tailscale"
        ? t("phone.error.tailscaleUnavailable")
        : directPairingUnavailable());
      deps.dispatchFlow({ type: "reset" });
      return;
    }
    const paired = await keepPhonePairingIfCurrent(
      () => mutateCompanionBridgeState(
        deps.companionMutationEpoch,
        () => companion.pairing(true),
      ),
      (opened) => closePhonePairingIfOwned(
        opened,
        () => companion.state(),
        () => mutateCompanionBridgeState(
          deps.companionMutationEpoch,
          () => companion.pairing(false, opened.pairing?.token),
        ),
        staleAttemptMayClose,
      ),
      isCurrent,
    );
    if (!paired) return;

    const pairingWindow = paired.pairing;
    const pairingFailure = companionPairingOpenFailure(
      paired,
      started.pairing?.token ?? null,
    );
    const routePin = pairingFailure ? null : companionPairingRoutePin(paired, routeMode);
    if (pairingFailure || !routePin || !pairingWindow) {
      await closePhonePairingIfOwned(
        paired,
        () => companion.state(),
        () => mutateCompanionBridgeState(
          deps.companionMutationEpoch,
          () => companion.pairing(false, paired.pairing?.token),
        ),
        isCurrent,
      );
      if (!isCurrent()) return;
      deps.publishPairingRoutePin(null);
      deps.setState({ ...paired, pairing: null });
      deps.setProvisioning(false);
      deps.setError(pairingFailure ?? (routeMode === "local"
        ? directPairingUnavailable()
        : routeMode === "tailscale"
          ? t("phone.error.tailscaleUnavailable")
          : protectedPairingUnavailable()));
      deps.dispatchFlow({ type: "reset" });
      return;
    }
    deps.publishPairingRoutePin({
      ...routePin,
      generation,
      token: pairingWindow.token,
    });
    deps.setState(paired);
    deps.setProvisioning(false);
    deps.setSetupTimedOut(false);
    deps.dispatchFlow({
      type: "pairing-opened",
      deviceIds: paired.devices.map((device) => device.id),
    });
  } catch (cause) {
    if (!isCurrent()) return;
    deps.publishPairingRoutePin(null);
    deps.setProvisioning(false);
    deps.setError(normalizePhoneSetupActionError(
      cause,
      t("phone.error.pairingPrepare"),
    ));
    deps.dispatchFlow({ type: "reset" });
  } finally {
    finishAttempt();
  }
}
