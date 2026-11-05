import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { t } from "@/lib/i18n";
import type { CompanionAccountState } from "../../types/ogb";
import type { CompanionPairingRouteMode } from "../../lib/companion-pairing";
import { companionPairingRoutePinAvailable } from "../../lib/companion-pairing";
import {
  claimPhonePairingAttempt,
  closePhonePairingIfOwned,
  invalidatePhonePairingAttempt,
  newlyPairedDeviceForFlow,
  phonePairingGate,
  phoneSetupBaseline,
  queuePhonePairingAttempt,
  releasePhonePairingAttempt,
  shouldArmPhoneSetupProvisioningTimeout,
  PHONE_SETUP_PROVISIONING_TIMEOUT_MS,
  type PhonePairingAttemptLock,
  type PhonePairingAttemptQueue,
  type PhoneSetupEvent,
  type PhoneSetupFlowState,
} from "../../lib/phone-setup";
import {
  companionBridge,
  mutateCompanionBridgeState,
  protectedPairingUnavailable,
} from "./bridges";
import { runPhonePairingAttempt } from "./runPhonePairingAttempt";
import type {
  CompanionState,
  CompanionStateMutationEpoch,
  OwnedCompanionPairingRoutePin,
  PhonePairingRequest,
} from "./types";

export function usePhoneSetupPairing(args: {
  account: CompanionAccountState | null;
  state: CompanionState | null;
  flow: PhoneSetupFlowState;
  provisioning: boolean;
  setupTimedOut: boolean;
  pairingRoutePinState: OwnedCompanionPairingRoutePin | null;
  mounted: MutableRefObject<boolean>;
  setupGeneration: MutableRefObject<number>;
  companionMutationEpoch: CompanionStateMutationEpoch;
  pairingUiOwner: MutableRefObject<PhonePairingAttemptLock>;
  pairingAttemptQueue: MutableRefObject<PhonePairingAttemptQueue<PhonePairingRequest>>;
  pairingRoutePinRef: MutableRefObject<OwnedCompanionPairingRoutePin | null>;
  runPairingAttemptRef: MutableRefObject<(request: PhonePairingRequest) => Promise<void>>;
  publishPairingRoutePin: (pin: OwnedCompanionPairingRoutePin | null) => void;
  setState: Dispatch<SetStateAction<CompanionState | null>>;
  setError: (value: string | null) => void;
  setAccountError: (value: string | null) => void;
  setProvisioning: (value: boolean) => void;
  setSetupTimedOut: (value: boolean) => void;
  setPairingBusy: (value: boolean) => void;
  setAccountBusy: (value: boolean) => void;
  setCodeSent: (value: boolean) => void;
  setCodeState: (value: string) => void;
  dispatchFlow: Dispatch<PhoneSetupEvent>;
  act: (call: (companion: import("./types").CompanionBridge) => Promise<CompanionState>) => Promise<void>;
}) {
  const {
    account,
    state,
    flow,
    provisioning,
    setupTimedOut,
    pairingRoutePinState,
    mounted,
    setupGeneration,
    companionMutationEpoch,
    pairingUiOwner,
    pairingAttemptQueue,
    pairingRoutePinRef,
    runPairingAttemptRef,
    publishPairingRoutePin,
    setState,
    setError,
    setAccountError,
    setProvisioning,
    setSetupTimedOut,
    setPairingBusy,
    setAccountBusy,
    setCodeSent,
    setCodeState,
    dispatchFlow,
    act,
  } = args;

  const runPairingAttempt = useCallback(
    async (request: PhonePairingRequest) => {
      await runPhonePairingAttempt(
        {
          mounted,
          setupGeneration,
          companionMutationEpoch,
          pairingUiOwner,
          pairingAttemptQueue,
          pairingRoutePinRef,
          runPairingAttemptRef,
          account,
          state,
          publishPairingRoutePin,
          setState,
          setError,
          setProvisioning,
          setSetupTimedOut,
          setPairingBusy,
          dispatchFlow,
        },
        request,
      );
    },
    [
      account,
      companionMutationEpoch,
      dispatchFlow,
      mounted,
      pairingAttemptQueue,
      pairingRoutePinRef,
      pairingUiOwner,
      publishPairingRoutePin,
      runPairingAttemptRef,
      setError,
      setPairingBusy,
      setProvisioning,
      setSetupTimedOut,
      setState,
      setupGeneration,
      state,
    ],
  );

  useLayoutEffect(() => {
    runPairingAttemptRef.current = runPairingAttempt;
  }, [runPairingAttempt, runPairingAttemptRef]);

  const openPairing = useCallback((
    routeMode: CompanionPairingRouteMode,
    accountOverride?: CompanionAccountState | null,
    generation = setupGeneration.current,
  ) => {
    const request = { routeMode, accountOverride, generation };
    const decision = queuePhonePairingAttempt(pairingAttemptQueue.current, request);
    if (decision === "duplicate") return;
    claimPhonePairingAttempt(pairingUiOwner.current, generation);
    setPairingBusy(true);
    if (decision === "start") void runPairingAttemptRef.current(request);
  }, [pairingAttemptQueue, pairingUiOwner, runPairingAttemptRef, setPairingBusy, setupGeneration]);

  const start = useCallback(() => {
    const baseline = phoneSetupBaseline(state?.devices ?? null);
    if (!baseline) return;
    const generation = ++setupGeneration.current;
    dispatchFlow({ type: "start", deviceIds: baseline });
    setError(null);
    setAccountError(null);
    setSetupTimedOut(false);
    if (
      phonePairingGate(account, state, false) === "open"
      || (account?.available && (account.status === "ready" || account.status === "connecting"))
    ) {
      setProvisioning(true);
      void openPairing("automatic", account, generation);
    }
  }, [account, dispatchFlow, openPairing, setAccountError, setError, setProvisioning, setSetupTimedOut, setupGeneration, state]);

  const useLocal = useCallback(() => {
    const baseline = phoneSetupBaseline(state?.devices ?? null);
    if (!baseline) return;
    if (!flow.active) {
      dispatchFlow({ type: "start", deviceIds: baseline });
    }
    const generation = ++setupGeneration.current;
    dispatchFlow({ type: "use-local" });
    setProvisioning(true);
    setSetupTimedOut(false);
    setAccountError(null);
    void openPairing("local", undefined, generation);
  }, [dispatchFlow, flow.active, openPairing, setAccountError, setProvisioning, setSetupTimedOut, setupGeneration, state?.devices]);

  const useTailscale = useCallback(() => {
    const baseline = phoneSetupBaseline(state?.devices ?? null);
    if (!baseline) return;
    if (!flow.active) {
      dispatchFlow({ type: "start", deviceIds: baseline });
    }
    const generation = ++setupGeneration.current;
    dispatchFlow({ type: "use-tailscale" });
    setProvisioning(true);
    setSetupTimedOut(false);
    setAccountError(null);
    void openPairing("tailscale", undefined, generation);
  }, [dispatchFlow, flow.active, openPairing, setAccountError, setProvisioning, setSetupTimedOut, setupGeneration, state?.devices]);

  const refreshTailscale = useCallback(() => {
    void act((companion) => companion.refreshTailscale());
  }, [act]);

  const cancel = useCallback(() => {
    const cancelledGeneration = setupGeneration.current;
    setupGeneration.current += 1;
    invalidatePhonePairingAttempt(pairingAttemptQueue.current, cancelledGeneration);
    releasePhonePairingAttempt(pairingUiOwner.current, cancelledGeneration);
    setPairingBusy(false);
    const snapshot = state;
    const companion = companionBridge();
    publishPairingRoutePin(null);
    setState((current) => current ? { ...current, pairing: null } : current);
    if (companion && snapshot?.pairing) {
      void closePhonePairingIfOwned(
        snapshot,
        () => companion.state(),
        () => mutateCompanionBridgeState(
          companionMutationEpoch,
          () => companion.pairing(false, snapshot.pairing?.token),
        ),
        () => pairingRoutePinRef.current === null,
      );
    }
    setProvisioning(false);
    setAccountBusy(false);
    setSetupTimedOut(false);
    setCodeSent(false);
    setCodeState("");
    dispatchFlow({ type: "reset" });
  }, [
    companionMutationEpoch,
    dispatchFlow,
    pairingAttemptQueue,
    pairingRoutePinRef,
    pairingUiOwner,
    publishPairingRoutePin,
    setAccountBusy,
    setCodeSent,
    setCodeState,
    setPairingBusy,
    setProvisioning,
    setSetupTimedOut,
    setState,
    setupGeneration,
    state,
  ]);

  const refreshCode = useCallback(() => {
    const pairingRouteMode: CompanionPairingRouteMode = flow.localFallback
      ? "local"
      : flow.tailscaleFallback
        ? "tailscale"
        : "automatic";
    const generation = ++setupGeneration.current;
    void openPairing(pairingRouteMode, undefined, generation);
  }, [flow.localFallback, flow.tailscaleFallback, openPairing, setupGeneration]);

  const finish = useCallback(() => {
    const generation = setupGeneration.current;
    setupGeneration.current += 1;
    invalidatePhonePairingAttempt(pairingAttemptQueue.current, generation);
    releasePhonePairingAttempt(pairingUiOwner.current, generation);
    setPairingBusy(false);
    publishPairingRoutePin(null);
    setSetupTimedOut(false);
    dispatchFlow({ type: "reset" });
  }, [
    dispatchFlow,
    pairingAttemptQueue,
    pairingUiOwner,
    publishPairingRoutePin,
    setPairingBusy,
    setSetupTimedOut,
    setupGeneration,
  ]);

  const skip = useCallback(() => {
    const generation = setupGeneration.current;
    setupGeneration.current += 1;
    invalidatePhonePairingAttempt(pairingAttemptQueue.current, generation);
    releasePhonePairingAttempt(pairingUiOwner.current, generation);
    setPairingBusy(false);
    publishPairingRoutePin(null);
    dispatchFlow({ type: "skip" });
  }, [dispatchFlow, pairingAttemptQueue, pairingUiOwner, publishPairingRoutePin, setPairingBusy, setupGeneration]);

  useEffect(() => {
    if (
      !flow.active
      || flow.localFallback
      || flow.tailscaleFallback
      || !account
      || (account.available && account.status !== "signed-out" && account.status !== "error")
    ) {
      return;
    }
    setProvisioning(false);
  }, [account, flow.active, flow.localFallback, flow.tailscaleFallback, setProvisioning]);

  useEffect(() => {
    if (!shouldArmPhoneSetupProvisioningTimeout(flow, {
      provisioning,
      provisioningTimedOut: setupTimedOut,
    })) return;
    const timer = window.setTimeout(() => {
      const timedOutGeneration = setupGeneration.current;
      setupGeneration.current += 1;
      invalidatePhonePairingAttempt(pairingAttemptQueue.current, timedOutGeneration);
      releasePhonePairingAttempt(pairingUiOwner.current, timedOutGeneration);
      setPairingBusy(false);
      setAccountBusy(false);
      setProvisioning(false);
      setSetupTimedOut(true);
    }, PHONE_SETUP_PROVISIONING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [
    flow,
    pairingAttemptQueue,
    pairingUiOwner,
    provisioning,
    setAccountBusy,
    setPairingBusy,
    setProvisioning,
    setSetupTimedOut,
    setupGeneration,
    setupTimedOut,
  ]);

  useEffect(() => {
    const pin = pairingRoutePinState;
    if (!pin || !state) return;
    if (!state.pairing) {
      publishPairingRoutePin(null);
      return;
    }

    const tokenMatches = state.pairing.token === pin.token;
    const routeAvailable = companionPairingRoutePinAvailable(state, pin);
    if (tokenMatches && routeAvailable) return;

    const companion = companionBridge();
    if (setupGeneration.current === pin.generation) setupGeneration.current += 1;
    invalidatePhonePairingAttempt(pairingAttemptQueue.current, pin.generation);
    releasePhonePairingAttempt(pairingUiOwner.current, pin.generation);
    setPairingBusy(false);
    publishPairingRoutePin(null);
    setState((current) => current ? { ...current, pairing: null } : current);
    setProvisioning(false);
    setSetupTimedOut(false);
    setError(tokenMatches
      ? protectedPairingUnavailable()
      : t("phone.error.codeChanged"));
    dispatchFlow({ type: "reset" });

    if (tokenMatches && companion) {
      void closePhonePairingIfOwned(
        state,
        () => companion.state(),
        () => mutateCompanionBridgeState(
          companionMutationEpoch,
          () => companion.pairing(false, state.pairing?.token),
        ),
        () => {
          const activePin = pairingRoutePinRef.current;
          return !activePin || activePin.generation === pin.generation;
        },
      );
    }
  }, [
    companionMutationEpoch,
    dispatchFlow,
    pairingAttemptQueue,
    pairingRoutePinRef,
    pairingRoutePinState,
    pairingUiOwner,
    publishPairingRoutePin,
    setError,
    setPairingBusy,
    setProvisioning,
    setSetupTimedOut,
    setState,
    setupGeneration,
    state,
  ]);

  useEffect(() => {
    if (!state) return;
    const device = newlyPairedDeviceForFlow(flow, state.devices);
    if (device) dispatchFlow({ type: "paired", deviceName: device.name });
  }, [dispatchFlow, flow, state]);

  useEffect(() => {
    if (
      !flow.active ||
      flow.localFallback ||
      flow.tailscaleFallback ||
      flow.pairingAttempted ||
      setupTimedOut ||
      !state ||
      phonePairingGate(account, state, false) !== "open"
    ) {
      return;
    }
    void openPairing("automatic");
  }, [account, flow.active, flow.localFallback, flow.pairingAttempted, flow.tailscaleFallback, openPairing, setupTimedOut, state]);

  return {
    openPairing,
    start,
    useLocal,
    useTailscale,
    refreshTailscale,
    cancel,
    refreshCode,
    finish,
    skip,
  };
}
