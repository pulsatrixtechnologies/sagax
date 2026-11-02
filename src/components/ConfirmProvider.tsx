// Promise-based confirmations for the whole app. Every destructive or
// discard prompt goes through ConfirmDialog (lot 8): never window.confirm.
// Mount ConfirmProvider once near the app root; useConfirm() in components,
// or confirmAsync() from non-hook code once the provider is up.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { t } from "@/lib/i18n";
import { ConfirmDialog, type ConfirmTone } from "./ConfirmDialog";

export type ConfirmRequest = {
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: ConfirmTone;
  icon?: ReactNode;
  extra?: ReactNode;
};

/** Accepts a structured request, or a single title string (legacy message). */
export type ConfirmFn = (request: ConfirmRequest | string) => Promise<boolean>;

export function normalizeConfirmRequest(request: ConfirmRequest | string): ConfirmRequest {
  if (typeof request === "string") {
    return { title: request, confirmLabel: t("common.confirm"), tone: "danger" };
  }
  return request;
}

type Pending = ConfirmRequest & {
  resolve: (ok: boolean) => void;
  confirmLabel: string;
  tone: ConfirmTone;
  body: string;
};

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Shared "close without saving" prompt (editors, drafts, creation). */
export function discardConfirmRequest(body?: string): ConfirmRequest {
  return {
    title: t("confirm.discard.title"),
    body: body ?? t("confirm.discard.body"),
    confirmLabel: t("confirm.discard.action"),
    tone: "danger",
  };
}

let activeConfirm: ConfirmFn | null = null;

/** Confirm from non-hook code while ConfirmProvider is mounted. Without a
 * provider (tests that never mount one) the call fails closed. */
export function confirmAsync(request: ConfirmRequest | string): Promise<boolean> {
  if (activeConfirm) return activeConfirm(normalizeConfirmRequest(request));
  return Promise.resolve(false);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const queueRef = useRef<Pending[]>([]);

  const settle = useCallback((ok: boolean) => {
    setPending((current) => {
      if (!current) return null;
      current.resolve(ok);
      const next = queueRef.current.shift() ?? null;
      return next;
    });
  }, []);

  const confirm = useCallback<ConfirmFn>((request) => {
    const normalized = normalizeConfirmRequest(request);
    return new Promise<boolean>((resolve) => {
      const entry: Pending = {
        ...normalized,
        body: normalized.body ?? "",
        confirmLabel: normalized.confirmLabel ?? t("common.confirm"),
        tone: normalized.tone ?? "danger",
        resolve,
      };
      setPending((current) => {
        if (current) {
          queueRef.current.push(entry);
          return current;
        }
        return entry;
      });
    });
  }, []);

  useEffect(() => {
    activeConfirm = confirm;
    return () => {
      if (activeConfirm === confirm) activeConfirm = null;
    };
  }, [confirm]);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          open
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          tone={pending.tone}
          icon={pending.icon}
          extra={pending.extra}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

/** Prefer the nearest ConfirmProvider. Without one, confirmAsync fails closed
 * (returns false) so a screen can still render in a test that never mounts
 * the provider. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? confirmAsync;
}
