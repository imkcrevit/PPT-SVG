import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const mcpServerPath = fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));

export const name = "ppt-svg-runtime";

export function apply(ctx) {
  ctx.provide("pptSvgRuntime", Object.freeze({ pluginRoot, mcpServerPath }));
}
