#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const VALID_LANGUAGES = new Set(["en", "zh"]);
const VALID_SKILLS = new Set([
  "freeform",
  "flow",
  "matrix",
  "timeline",
  "pyramid",
  "architecture",
  "hierarchy",
  "cycle",
  "funnel",
  "venn",
  "mindmap",
  "fishbone",
  "gantt",
  "swimlane",
  "scatter"
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const prompt = args.prompt?.trim();
  const language = args.language || "en";
  const skillId = args.skill || "freeform";
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.PPT_SVG_BASE_URL || "http://127.0.0.1:3000/ppt");

  if (!prompt) {
    throw new Error("Missing --prompt.");
  }

  if (!VALID_LANGUAGES.has(language)) {
    throw new Error(`Invalid --language '${language}'. Use en or zh.`);
  }

  if (!VALID_SKILLS.has(skillId)) {
    throw new Error(`Invalid --skill '${skillId}'. Use --help to list supported skills.`);
  }

  const payload = {
    skillId,
    userDescription: prompt,
    language,
    ...(args.session ? { sessionId: args.session } : {}),
    ...(args.turn ? { conversationTurn: Number(args.turn) } : {})
  };

  const generated = await postJson(`${baseUrl}/api/generate`, payload);

  if (args.json) {
    await writeJson(args.json, generated);
  }

  if (args.bundle) {
    await writeBundle(`${baseUrl}/api/export/bundle`, {
      ...generated,
      sessionId: generated.sessionId,
      requestId: generated.requestId
    }, args.bundle);
  }

  const summary = {
    title: generated.figure?.metadata?.title,
    skillId: generated.figure?.metadata?.skillId ?? skillId,
    language: generated.figure?.metadata?.language ?? language,
    requestId: generated.requestId,
    sessionId: generated.sessionId,
    model: generated.model,
    fit: generated.fit,
    jsonPath: args.json ? path.resolve(args.json) : undefined,
    bundlePath: args.bundle ? path.resolve(args.bundle) : undefined,
    artifacts: generated.artifacts
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      args.prompt = args.prompt ? `${args.prompt} ${arg}` : arg;
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}.`);
    }

    index += 1;

    switch (key) {
      case "base-url":
        args.baseUrl = next;
        break;
      case "bundle":
        args.bundle = next;
        break;
      case "json":
        args.json = next;
        break;
      case "language":
        args.language = next;
        break;
      case "prompt":
        args.prompt = next;
        break;
      case "session":
        args.session = next;
        break;
      case "skill":
        args.skill = next;
        break;
      case "turn":
        args.turn = next;
        break;
      default:
        throw new Error(`Unknown option --${key}.`);
    }
  }

  return args;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const data = text ? parseJson(text, url) : {};

  if (!response.ok) {
    const message = data.error || data.message || `Request failed with status ${response.status}.`;
    const details = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
    throw new Error(`${message}${details}`);
  }

  return data;
}

async function writeBundle(url, payload, filePath) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    let data = {};

    if (text) {
      data = parseJson(text, url);
    }

    const message = data.error || data.message || `Bundle export failed with status ${response.status}.`;
    const details = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
    throw new Error(`${message}${details}`);
  }

  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseJson(text, url) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response from ${url} was not valid JSON.`);
  }
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/ppt-svg-agent.mjs --prompt "..." [options]

Options:
  --base-url URL       PPT-SVG service base URL. Defaults to PPT_SVG_BASE_URL or http://127.0.0.1:3000/ppt.
  --language en|zh     Output language. Defaults to en.
  --skill ID           Diagram skill. Defaults to freeform.
  --session ID         Optional session ID.
  --turn NUMBER        Optional conversation turn.
  --json PATH          Write the raw generation response.
  --bundle PATH        Write a zip with SVG, PPTX, JSON, and metadata.
  --help               Show this help.

Skills:
  ${Array.from(VALID_SKILLS).join(", ")}
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
