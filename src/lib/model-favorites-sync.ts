// #2050: keeps the person's starred models on the server (GET/PUT
// /api/me/models, `favoriteModels`) beside their model switches. One hook,
// mounted by the model selector: attaches the server copy while a person
// is signed in (state.config.viewer), detaches otherwise.
// Detail: src/lib/model-favorites.ts (attachModelFavoritesServer).
import { useContext, useEffect } from "react";

import { api, useStoreOptional, type AppState } from "@/state/store";
import { StoreSourceContext, useSourceSelector, type StoreSource } from "@/state/store-selector";
import { attachModelFavoritesServer } from "./model-favorites";

const PATH = "/api/me/models";

const signedInOf = (state: AppState) => Boolean(state.config?.viewer);

/** Whether a person is signed in: renders only when that changes (#3624),
 * never for another bot's frame. Outside a store, false. */
function useSignedIn(): boolean {
  const source = useContext(StoreSourceContext);
  // a tree has a source or it does not for the life of the component
  if (!source) return Boolean(useStoreOptional()?.state.config?.viewer);
  return useSourceSelector(source as StoreSource<AppState, unknown>, signedInOf);
}

export function useModelFavoritesServerSync(): void {
  const signedIn = useSignedIn();
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
