import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = process.cwd();
const pluginRoot = path.join(repositoryRoot, "plugins", "ppt-svg");
const localBaseUrl = "http://127.0.0.1:3000/ppt";
const publicBaseUrl = "https://labs.graptolite.ai/ppt";

const manifest = JSON.parse(await readFile(path.join(pluginRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "dsh-ppt-svg");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.publishConfig?.access, "public");

const patch = await readFile(path.join(pluginRoot, "cordis.patch.yml"), "utf8");
assert.match(patch, /name: dsh-ppt-svg\/dsh\/runtime/);
assert.match(patch, /name: dsh-ppt-svg\/dsh\/skills/);
assert.match(patch, /name: '@deepseek-ai\/dsh-mcp-client'/);
assert.match(patch, new RegExp(escapeRegExp(localBaseUrl)));
assert.doesNotMatch(patch, new RegExp(escapeRegExp(publicBaseUrl)));

for (const relativePath of [
  "mcp/server.mjs",
  "skills/svg/scripts/generate-svg.mjs",
  "skills/ppt/scripts/generate-ppt.mjs"
]) {
  const content = await readFile(path.join(pluginRoot, relativePath), "utf8");
  assert.match(content, new RegExp(escapeRegExp(localBaseUrl)), `${relativePath} must default locally`);
  assert.doesNotMatch(content, new RegExp(escapeRegExp(publicBaseUrl)), `${relativePath} must not default publicly`);
}

const providers = [];
const skillsModule = await import(pathToFileURL(path.join(pluginRoot, "dsh", "skills.mjs")));
skillsModule.apply({ skills: { registerProvider: (create) => providers.push(create()) } });
assert.equal(providers.length, 1);

const candidates = await providers[0].list();
assert.deepEqual(candidates.map((candidate) => candidate.name), ["svg", "ppt"]);
assert.deepEqual(candidates.map((candidate) => candidate.rank), [600, 600]);
for (const candidate of candidates) {
  const definition = await providers[0].get(candidate);
  assert.equal(definition.name, candidate.name);
  assert.equal(definition.provider, "ppt-svg-dsh");
  assert.equal(definition.source, "bundled");
  assert.ok(!definition.content.startsWith("---"), `${candidate.name} frontmatter must not leak into the skill body`);
  await access(definition.resourceBase.path);
}

let runtime;
const runtimeModule = await import(pathToFileURL(path.join(pluginRoot, "dsh", "runtime.mjs")));
runtimeModule.apply({ provide: (name, value) => { runtime = { name, value }; } });
assert.equal(runtime.name, "pptSvgRuntime");
await access(runtime.value.pluginRoot);
await access(runtime.value.mcpServerPath);

console.log("DSH BUNDLE ASSERTIONS PASS");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
