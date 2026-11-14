// The key card of one Perspicax product (#4185), raised in the chat when a
// bot needs the person's own key for it (request_product_key). It holds no
// form: when it draws, it reads the product from Perspicax (the fresh form
// and state), then sends the values there, as the person, through
// POST /api/bots/:id/secret-cards/:messageId/product-key; Perspicax saves
// and tests the key. A key the vendor accepts folds the card into one line
// and the bot goes on; a refused one keeps the card open with the vendor's
// reason so the person corrects it ("Not now" resumes with the refusal).
// The values never enter the message, the chat or the bot's context.
// Only the person the card was raised for (`product.for`) sees the form: any
// other viewer of a group conversation sees the folded line.
import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, Loader2, RefreshCw, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { loadPersonProduct, productKeyTargets, productStateLabel, productsUnavailable, type PersonProduct } from "@/lib/person-products";
import { api, useStore, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { ASK_PRIMARY_BUTTON, ASK_QUIET_BUTTON, AskCard, AskSettledLine, returnFocusToComposer } from "./AskCard";
import { ProductKeyForm } from "./plugins/ProductKeyForm";

export function ProductKeyCard({ botId, threadId, message }: { botId: string; threadId: string; message: Message }) {
  const secret = message.secret!;
  const asked = secret.product!;
  const { state } = useStore();
  const viewer = state.config?.viewer?.principalId?.trim().toLowerCase();
  const otherViewer = Boolean(asked.for && viewer && asked.for.trim().toLowerCase() !== viewer);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/secret-cards/${encodeURIComponent(message.id)}`;
  const [product, setProduct] = useState<PersonProduct | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notMine, setNotMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const open = !secret.provided && !secret.dismissed && !secret.superseded && !secret.stopped && !otherViewer;

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadPersonProduct(asked.id).then(
      (next) => { if (live) setProduct(next); },
      (failure: unknown) => {
        if (!live) return;
        // not one of the viewer's products: another viewer of the chat sees the folded line only
        if (productsUnavailable(failure)) setNotMine(true);
        else setLoadError(readableError(failure));
      },
    );
    return () => { live = false; };
  }, [open, asked.id]);

  const refused = secret.result && !secret.result.ok ? secret.result : null;
  const reasonWords = refused ? [refused.status, refused.code].filter((part) => part !== undefined && part !== "").join(", ") : "";

  if (secret.superseded) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={asked.name}>
        <span className="text-ink-secondary">{asked.name}</span>
        <span> · {t("productKeyCard.superseded")}</span>
      </AskSettledLine>
    );
  }
  if (secret.stopped && !secret.provided) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={asked.name}>
        <span className="text-ink-secondary">{asked.name}</span>
        <span> · {t("productKeyCard.stopped")}</span>
      </AskSettledLine>
    );
  }
  if (secret.provided) {
    const retry = !secret.resumed && !secret.stopped && secret.error ? (
      <button type="button" disabled={retrying} className={cn(ASK_QUIET_BUTTON, "text-accent-text")} onClick={() => {
        setRetrying(true);
        void api(`${endpoint}/resume`, { method: "POST", body: JSON.stringify({ threadId }) }).catch((failure: unknown) => setError(readableError(failure))).finally(() => setRetrying(false));
      }}>
        {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t("secretRequest.tryAgain")}
      </button>
    ) : undefined;
    return (
      <AskSettledLine ariaLabel={asked.name} action={retry}
        icon={secret.resumed || secret.stopped ? undefined : secret.error ? <KeyRound size={13} /> : <Loader2 size={13} className="animate-spin" />}
        detail={(error ?? secret.error) && <p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{error ?? secret.error}</p>}>
        <span className="text-ink-secondary" data-product-key-card-settled={asked.id}>{t("productKeyCard.saved", { name: asked.name })}</span>
      </AskSettledLine>
    );
  }
  if (secret.dismissed) {
    if (secret.resumed || !secret.error) return null;
    return (
      <AskSettledLine icon={<X size={13} className="text-danger" />} ariaLabel={asked.name}
        detail={<p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{secret.error}</p>}>
        <span className="text-ink-secondary">{asked.name}</span>
      </AskSettledLine>
    );
  }
  if (notMine || otherViewer) {
    return (
      <AskSettledLine icon={<KeyRound size={13} />} ariaLabel={asked.name}>
        <span className="text-ink-secondary">{t("productKeyCard.waiting", { name: asked.name })}</span>
      </AskSettledLine>
    );
  }

  const save = async (values: Record<string, string>) => {
    setError(null);
    try {
      const answer = await api<{ product?: PersonProduct }>(`${endpoint}/product-key`, { method: "POST", body: JSON.stringify({ threadId, values }) });
      if (answer.product) setProduct(answer.product);
      if (answer.product?.state === "connected" || answer.product?.state === "no_key_needed") returnFocusToComposer();
    } catch (failure) {
      setError(readableError(failure));
      throw failure;
    }
  };
  const dismiss = () => {
    void api(`${endpoint}/dismiss`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
  };

  const typesKey = product ? productKeyTargets(product).length > 0 : false;
  // a refused save says the refusal on its own line, once: the reason the
  // card was raised for is then out of date
  const explanation = refused ? t("productKeyCard.why.setup", { name: asked.name })
    : asked.reason === "key_refused" ? t("productKeyCard.why.refused", { name: asked.name })
    : asked.reason === "key_expired" ? t("productKeyCard.why.expired", { name: asked.name })
    : asked.reason === "key_misfit" ? t("productKeyCard.why.misfit", { name: asked.name })
    : asked.reason === "key_missing" ? t("productKeyCard.why.missing", { name: asked.name })
    : t("productKeyCard.why.setup", { name: asked.name });

  return (
    <AskCard ariaLabel={asked.name} icon={<KeyRound size={15} />} title={asked.name} explanation={explanation} onDismiss={dismiss} dismissLabel={t("productKeyCard.notNow")}>
      <div data-product-key-card={asked.id}>
        {!product && !loadError && (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><Loader2 size={13} className="animate-spin" /> {t("productKeyCard.loading")}</div>
        )}
        {loadError && <p role="alert" className="text-[12px] text-danger">{loadError}</p>}
        {refused && (
          <p role="alert" className="mb-2 text-[12px] text-danger" data-product-key-card-refused>
            {t("productKeyCard.refused", { reason: reasonWords || "?" })}
          </p>
        )}
        {product && typesKey && product.form ? (
          <ProductKeyForm form={product.form} productName={product.name} variant="card" onSave={save} submitLabel={t("productKeyCard.save")} />
        ) : product ? (
          <div className="space-y-2 text-[12.5px] leading-relaxed text-ink-secondary">
            <p>{productStateLabel(product.state)}</p>
            {product.consoleUrl && (
              <button type="button" className={ASK_PRIMARY_BUTTON} onClick={() => void openExternalLink(product.consoleUrl!)}>
                <ExternalLink size={14} /> {t("personProducts.openInPerspicax")}
              </button>
            )}
          </div>
        ) : null}
        {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      </div>
    </AskCard>
  );
}
