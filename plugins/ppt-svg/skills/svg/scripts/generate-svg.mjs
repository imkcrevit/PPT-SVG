#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://labs.graptolite.ai/ppt";
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
  "scatter",
  "kanban",
  "network",
  "radar",
  "heatmap",
  "waterfall"
]);
const SOURCE_EXTENSIONS = new Set(["pdf", "doc", "docx", "pptx", "md", "png", "jpg", "jpeg"]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const prompt = args.prompt?.trim();
  const language = args.language || "en";
  const skillId = args.skill || "freeform";
  const sources = args.sources || [];
  const turn = args.turn ? Number(args.turn) : 1;
  const sessionId = args.session || `svg-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.PPT_SVG_BASE_URL || DEFAULT_BASE_URL);

  if (!prompt) throw new Error("Missing --prompt.");
  if (!VALID_LANGUAGES.has(language)) throw new Error(`Invalid --language '${language}'. Use en or zh.`);
  if (!VALID_SKILLS.has(skillId)) throw new Error(`Invalid --skill '${skillId}'. Use --help to list supported skills.`);
  if (!Number.isInteger(turn) || turn < 1 || turn > 5) throw new Error("Invalid --turn. Use an integer from 1 to 5.");
  if (sources.length > 3) throw new Error("At most three --source files can be used in one SVG generation.");

  const attachments = [];
  for (const filePath of sources) {
    attachments.push(await uploadAttachment(baseUrl, filePath, sessionId));
  }

  const generated = await postJson(`${baseUrl}/api/generate`, {
    skillId,
    userDescription: prompt,
    language,
    sessionId,
    conversationId: sessionId,
    conversationTurn: turn,
    attachments: attachments.map(attachmentReference)
  });

  if (args.json) await writeJson(args.json, generated);
  if (args.bundle) {
    await writeBundle(
      `${baseUrl}/api/export/bundle`,
      {
        ...generated,
        sessionId: generated.sessionId || sessionId,
        requestId: generated.requestId
      },
      args.bundle
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        title: generated.figure?.metadata?.title,
        skillId: generated.figure?.metadata?.skillId ?? skillId,
        language: generated.figure?.metadata?.language ?? language,
        requestId: generated.requestId,
        sessionId: generated.sessionId || sessionId,
        model: generated.model,
        fit: generated.fit,
        sourceFiles: attachments.map((attachment) => attachment.originalName),
        jsonPath: args.json ? path.resolve(args.json) : undefined,
        bundlePath: args.bundle ? path.resolve(args.bundle) : undefined,
        artifacts: generated.artifacts
      },
      null,
      2
    )}\n`
  );
}

function parseArgs(argv) {
  const args = { sources: [] };
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
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
    index += 1;

    switch (key) {
      case "base-url": args.baseUrl = next; break;
      case "bundle": args.bundle = next; break;
      case "json": args.json = next; break;
      case "language": args.language = next; break;
      case "prompt": args.prompt = next; break;
      case "session": args.session = next; break;
      case "skill": args.skill = next; break;
      case "source": args.sources.push(next); break;
      case "turn": args.turn = next; break;
      default: throw new Error(`Unknown option --${key}.`);
    }
  }
  return args;
}

async function uploadAttachment(baseUrl, filePath, sessionId) {
  const extension = extensionOf(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported --source file '${filePath}'.`);
  }

  const bytes = await readFile(path.resolve(filePath));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeTypeFor(extension) }), path.basename(filePath));
  form.append("sessionId", sessionId);
  form.append("conversationId", sessionId);

  const response = await fetch(`${baseUrl}/api/attachments`, { method: "POST", body: form });
  const text = await response.text();
  const data = text ? parseJson(text, `${baseUrl}/api/attachments`) : {};
  if (!response.ok || !data.attachment) {
    throw new Error(data.error || `Upload failed with status ${response.status}.`);
  }
  return data.attachment;
}

function attachmentReference(attachment) {
  return {
    id: attachment.id,
    originalName: attachment.originalName,
    hash: attachment.hash,
    extension: attachment.extension,
    mimeType: attachment.mimeType,
    size: attachment.size,
    path: attachment.path,
    ...(attachment.extractedText ? { extractedText: attachment.extractedText } : {})
  };
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
    const details = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
    throw new Error(`${data.error || data.message || `Request failed with status ${response.status}.`}${details}`);
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
    const data = text ? parseJson(text, url) : {};
    throw new Error(data.error || data.message || `Bundle export failed with status ${response.status}.`);
  }
  await writeBytes(filePath, Buffer.from(await response.arrayBuffer()));
}

async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeBytes(filePath, value) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, value);
}

function parseJson(text, url) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response from ${url} was not valid JSON.`);
  }
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase().replace(/^\./, "");
}

function mimeTypeFor(extension) {
  return ({
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    md: "text/markdown",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg"
  })[extension] || "application/octet-stream";
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/generate-svg.mjs --prompt "..." [options]

Options:
  --base-url URL       Service base URL. Defaults to PPT_SVG_BASE_URL or ${DEFAULT_BASE_URL}.
  --language en|zh     Output language. Defaults to en.
  --skill ID           Diagram type. Defaults to freeform.
  --source PATH        Upload a source file. Repeat up to three times.
  --session ID         Optional session ID.
  --turn NUMBER        Conversation turn, 1-5. Defaults to 1.
  --json PATH          Write the raw generation response.
  --bundle PATH        Write SVG, one-slide PPTX, JSON, and metadata as a zip.
  --help               Show this help.

Skills:
  ${Array.from(VALID_SKILLS).join(", ")}
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
