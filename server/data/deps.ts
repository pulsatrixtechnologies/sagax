// The one module that names the engine, the chart compiler, the Vega-Lite
// validator and the renderer the Data surface runs on. Everything else in
// server/data/ takes them injected (tools.ts, rpc.ts, routes.ts, sheet.ts),
// so the tools and routes are tested with fakes and never open DuckDB;
// index.ts reads the real ones from here and nowhere else. The explicit
// types keep every consumer typed even while a module here is still being
// built in another worktree.
import type { ChartCompiler, ChartRenderer, DataEngine, VegaLiteValidator } from "./types.ts";
import { dataEngine as engine } from "./engine.ts";
import { compileChart as compile } from "./chart-compiler.ts";

export const dataEngine: DataEngine = engine;
export const compileChart: ChartCompiler = compile;
// Vega, Vega-Lite and its JSON schema load at the first chart, not with the server.
export const validateVegaLite: VegaLiteValidator = async (spec) => (await import("./vega-lite-validator.ts")).validateVegaLite(spec);
export const chartRenderer: ChartRenderer = {
  svg: async (...args) => (await import("./render.ts")).chartRenderer.svg(...args),
  png: async (...args) => (await import("./render.ts")).chartRenderer.png(...args),
};
