import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROVIDER_NAME = "ppt-svg-dsh";
const BUNDLED_SKILL_RANK = 600;
const INVOCATION = Object.freeze({ modelInvocable: true, userInvocable: true });
const SKILL_SPECS = ["svg", "ppt"].map((expectedName) => {
  const directoryUrl = new URL(`../skills/${expectedName}/`, import.meta.url);
  return Object.freeze({
    expectedName,
    skillUrl: new URL("SKILL.md", directoryUrl),
    resourceBase: Object.freeze({ kind: "directory", path: fileURLToPath(directoryUrl) })
  });
});

const specsByName = new Map(SKILL_SPECS.map((spec) => [spec.expectedName, spec]));

export const name = "ppt-svg-skills";
export const inject = ["skills"];

export function apply(ctx) {
  ctx.skills.registerProvider(() => ({
    name: PROVIDER_NAME,
    async list() {
      return Promise.all(SKILL_SPECS.map(createCandidate));
    },
    async get(candidate) {
      const spec = specsByName.get(candidate?.name);
      if (!spec) return undefined;
      const parsed = await readSkill(spec);
      return {
        name: parsed.name,
        description: parsed.description,
        invocation: INVOCATION,
        provider: PROVIDER_NAME,
        source: "bundled",
        resourceBase: spec.resourceBase,
        path: fileURLToPath(spec.skillUrl),
        content: parsed.content
      };
    }
  }));
}

async function createCandidate(spec) {
  const parsed = await readSkill(spec);
  return {
    name: parsed.name,
    description: parsed.description,
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: "bundled",
    resourceBase: spec.resourceBase,
    rank: BUNDLED_SKILL_RANK,
    locator: spec.skillUrl
  };
}

async function readSkill(spec) {
  const document = await readFile(spec.skillUrl, "utf8");
  const match = document.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Invalid skill frontmatter: ${fileURLToPath(spec.skillUrl)}`);

  const metadata = parseFrontmatter(match[1]);
  if (metadata.name !== spec.expectedName) {
    throw new Error(`Expected skill '${spec.expectedName}', received '${metadata.name || ""}'.`);
  }
  if (!metadata.description) throw new Error(`Skill '${spec.expectedName}' has no description.`);

  return {
    name: metadata.name,
    description: metadata.description,
    content: match[2].trimStart()
  };
}

function parseFrontmatter(value) {
  const metadata = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    metadata[key] = unquote(raw);
  }
  return metadata;
}

function unquote(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
