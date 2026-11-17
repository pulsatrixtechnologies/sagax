// `pnpm dev:server`: the harness from a source checkout, whose UI reaches it through Vite's dev proxy in a browser on
// this machine (port of OpenMausBot #2930). SAGAX_DEV_TRUST_LOCAL_BROWSER=0 tries the sign-in a self-hosted server
// asks a browser for. A packaged, bundled or desktop server ignores this variable (server/auth/request-auth.ts).
process.env.SAGAX_DEV_TRUST_LOCAL_BROWSER ??= "1";
const { ensureGeneratedKnowledge } = await import("../scripts/self-knowledge/ensure.mjs");
await ensureGeneratedKnowledge((await import("node:url")).fileURLToPath(new URL("../", import.meta.url)), true);
await import("./index.ts");
