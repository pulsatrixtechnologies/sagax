import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MODELS_SHOWN, ProviderModels, type ActiveProvider } from "./ModelSwitchesSettings";

const models = Array.from({ length: 16 }, (_, index) => ({ id: `m${index}`, label: `Model ${index}`, engines: [], keys: [`e/m${index}`] }));
const provider: ActiveProvider = { id: "claude", label: "Claude", kind: "vendor" as ActiveProvider["kind"], models };

describe("a provider's model list folds to its first rows", () => {
  it("shows the first rows and a Show N more line for the rest", () => {
    const html = renderToStaticMarkup(createElement(ProviderModels, { provider, switches: { org: null, mine: null }, mayEdit: true, onToggle: () => {}, busy: false, inPage: true }));
    expect((html.match(/data-model-switch="/g) ?? []).length).toBe(MODELS_SHOWN);
    expect(html).toContain('data-model-switches-fold="more"');
    expect(html).toContain(String(models.length - MODELS_SHOWN));
  });
});
