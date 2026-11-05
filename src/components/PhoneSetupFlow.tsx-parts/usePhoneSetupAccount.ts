import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { t } from "@/lib/i18n";
import type { CompanionAccountState } from "../../types/ogb";
import {
  normalizePhoneSetupActionError,
  phoneSetupBaseline,
  type PhoneSetupEvent,
  type PhoneSetupFlowState,
} from "../../lib/phone-setup";
import { companionAccountBridge, mutateCompanionBridgeState } from "./bridges";
import type { CompanionState, CompanionStateMutationEpoch } from "./types";
import type { CompanionPairingRouteMode } from "../../lib/companion-pairing";

export function usePhoneSetupAccount(args: {
  email: string;
  code: string;
  flow: PhoneSetupFlowState;
  state: CompanionState | null;
  mounted: MutableRefObject<boolean>;
  setupGeneration: MutableRefObject<number>;
  companionMutationEpoch: CompanionStateMutationEpoch;
  setAccount: Dispatch<SetStateAction<CompanionAccountState | null>>;
  setAccountBusy: (value: boolean) => void;
  setAccountError: (value: string | null) => void;
  setCodeState: (value: string) => void;
  setCodeSent: (value: boolean) => void;
  setProvisioning: (value: boolean) => void;
  setSetupTimedOut: (value: boolean) => void;
  dispatchFlow: Dispatch<PhoneSetupEvent>;
  openPairing: (
    routeMode: CompanionPairingRouteMode,
    accountOverride?: CompanionAccountState | null,
    generation?: number,
  ) => void;
  load: () => Promise<void>;
}) {
  const {
    email,
    code,
    flow,
    state,
    mounted,
    setupGeneration,
    companionMutationEpoch,
    setAccount,
    setAccountBusy,
    setAccountError,
    setCodeState,
    setCodeSent,
    setProvisioning,
    setSetupTimedOut,
    dispatchFlow,
    openPairing,
    load,
  } = args;

  const requestCode = useCallback(() => {
    const remote = companionAccountBridge();
    const normalized = email.trim().toLowerCase();
    if (!remote || !normalized) return;
    const generation = setupGeneration.current;
    setAccountBusy(true);
    setAccountError(null);
    void remote
      .requestCode(normalized)
      .then((next) => {
        if (!mounted.current || setupGeneration.current !== generation) return;
        setAccount(next);
        setCodeSent(true);
      })
      .catch((cause: unknown) => {
        if (!mounted.current || setupGeneration.current !== generation) return;
        setAccountError(
          normalizePhoneSetupActionError(cause, t("phone.error.sendCode")),
        );
      })
      .finally(() => {
        if (mounted.current && setupGeneration.current === generation) setAccountBusy(false);
      });
  }, [email, mounted, setAccount, setAccountBusy, setAccountError, setCodeSent, setupGeneration]);

  const verifyCode = useCallback(() => {
    const remote = companionAccountBridge();
    const normalized = email.trim().toLowerCase();
    if (!remote || code.length !== 8) return;
    const generation = setupGeneration.current;
    setAccountBusy(true);
    setProvisioning(true);
    setSetupTimedOut(false);
    setAccountError(null);
    void mutateCompanionBridgeState(
      companionMutationEpoch,
      () => remote.verifyCode(normalized, code),
    )
      .then(async (next) => {
        if (!mounted.current || setupGeneration.current !== generation) return;
        setAccount(next);
        setCodeState("");
        setCodeSent(false);
        await openPairing("automatic", next, generation);
      })
      .catch((cause: unknown) => {
        if (!mounted.current || setupGeneration.current !== generation) return;
        setProvisioning(false);
        setAccountError(
          normalizePhoneSetupActionError(cause, t("phone.error.verifyCode")),
        );
      })
      .finally(() => {
        if (mounted.current && setupGeneration.current === generation) setAccountBusy(false);
      });
  }, [
    code,
    companionMutationEpoch,
    email,
    mounted,
    openPairing,
    setAccount,
    setAccountBusy,
    setAccountError,
    setCodeSent,
    setCodeState,
    setProvisioning,
    setSetupTimedOut,
    setupGeneration,
  ]);

  const retryAccount = useCallback(() => {
    const remote = companionAccountBridge();
    if (!remote) return;
    const baseline = flow.active ? phoneSetupBaseline(state?.devices ?? null) : null;
    const generation = ++setupGeneration.current;
    if (baseline) dispatchFlow({ type: "start", deviceIds: baseline });
    setAccountBusy(true);
    setProvisioning(true);
    setSetupTimedOut(false);
    setAccountError(null);
    void mutateCompanionBridgeState(
      companionMutationEpoch,
      () => remote.retry(),
    )
      .then(async (next) => {
        if (!mounted.current || setupGeneration.current !== generation) return;
        setAccount(next);
        if (flow.active) await openPairing("automatic", next, generation);
        else {
          await load();
          if (mounted.current && setupGeneration.current === generation) setProvisioning(false);
        }
      })
      .catch((cause: unknown) => {
        if (!mounted.current || setupGeneration.current !== generation) return;
        setProvisioning(false);
        setAccountError(
          normalizePhoneSetupActionError(cause, t("phone.error.restore")),
        );
      })
      .finally(() => {
        if (mounted.current && setupGeneration.current === generation) setAccountBusy(false);
      });
  }, [
    companionMutationEpoch,
    dispatchFlow,
    flow.active,
    load,
    mounted,
    openPairing,
    setAccount,
    setAccountBusy,
    setAccountError,
    setProvisioning,
    setSetupTimedOut,
    setupGeneration,
    state?.devices,
  ]);

  return { requestCode, verifyCode, retryAccount };
}
