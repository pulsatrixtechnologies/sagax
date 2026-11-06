// #2050: keeps the person's starred models on the server (GET/PUT
// /api/me/models, `favoriteModels`) beside their model switches. One hook,
// mounted by the model selector: attaches the server copy while a person
// is signed in (state.config.viewer), detaches otherwise.
// Detail: src/lib/model-favorites.ts (attachModelFavoritesServer).
import { useEffect } from "react";

import { api, useStoreOptional } from "@/state/store";
import { attachModelFavoritesServer } from "./model-favorites";

const PATH = "/api/me/models";

export function useModelFavoritesServerSync(): void {
  const store = useStoreOptional();
  const signedIn = Boolean(store?.state.config?.viewer);
  useEffect(() => {
    if (!signedIn) return;
    void attachModelFavoritesServer({
      load: async () => {
        const answer = await api<{ favoriteModels?: unknown }>(PATH).catch(() => undefined);
        return Array.isArray(answer?.favoriteModels) ? (answer.favoriteModels as string[]) : undefined;
      },
      save: (list) => api(PATH, { method: "PUT", body: JSON.stringify({ favoriteModels: list }) }),
    });
  }, [signedIn]);
}
