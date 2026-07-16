#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://labs.graptolite.ai/ppt";
const VALID_LANGUAGES = new Set(["en", "zh"]);
const VALID_STYLES = new Set(["tech", "corporate", "academic", "government", "nature", "creative", "minimal"]);
const SOURCE_EXTENSIONS = new Set(["pdf", "doc", "docx", "pptx", "md", "png", "jpg", "jpeg"]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const prompt = args.prompt?.trim();
  const language = args.language || "en";
  const style = args.style || "tech";
  const sources = args.sources || [];
  const sessionId = args.session || `ppt-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.PPT_SVG_BASE_URL || DEFAULT_BASE_URL);
  const outPath = args.out || "presentation.pptx";

  if (!prompt) throw new Error("Missing --prompt.");
  if (!VALID_LANGUAGES.has(language)) throw new Error(`Invalid --language '${language}'. Use en or zh.`);
  if (!VALID_STYLES.has(style)) throw new Error(`Invalid --style '${style}'. Use --help to list supported styles.`);
  if (sources.length + (args.template ? 1 : 0) > 3) {
    throw new Error("At most three uploaded files are allowed, including --source files and --template.");
  }

  const sourceAttachments = [];
  for (const filePath of sources) {
    sourceAttachments.push(await uploadAttachment(baseUrl, filePath, sessionId, SOURCE_EXTENSIONS));
  }

  let templateAttachment;
  if (args.template) {
    if (extensionOf(args.template) !== "pptx") throw new Error("--template must be a .pptx file.");
    templateAttachment = await uploadAttachment(baseUrl, args.template, sessionId, new Set(["pptx"]));
  }

  const allAttachments = [...sourceAttachments, ...(templateAttachment ? [templateAttachment] : [])];
  const generated = await postJson(`${baseUrl}/api/lab/deck`, {
    context: prompt,
    language,
    styleHint: args.styleHint || "",
    templateId: style,
    attachments: allAttachments.map(attachmentReference),
    ...(templateAttachment ? { templateHash: templateAttachment.hash } : {}),
    sessionId
  });

  if (!generated.deck || !generated.pptxBase64) {
    throw new Error("The service response did not contain a compiled deck and PPTX file.");
  }

  await writeBytes(outPath, Buffer.from(generated.pptxBase64, "base64"));
  const { pptxBase64: _pptxBase64, ...metadata } = generated;
  if (args.json) await writeJson(args.json, metadata);

  process.stdout.write(
    `${JSON.stringify(
      {
        title: generated.deck.title,
        slides: generated.deck.slides?.length,
        language: generated.deck.language || language,
        style: generated.deck.templateId || style,
        requestId: generated.requestId,
        sessionId,
        model: generated.model,
        warnings: generated.warnings || [],
        sourceFiles: sourceAttachments.map((attachment) => attachment.originalName),
        templateFile: templateAttachment?.originalName,
        pptxPath: path.resolve(outPath),
        jsonPath: args.json ? path.resolve(args.json) : undefined
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
      case "json": args.json = next; break;
      case "language": args.language = next; break;
      case "out": args.out = next; break;
      case "prompt": args.prompt = next; break;
      case "session": args.session = next; break;
      case "source": args.sources.push(next); break;
      case "style": args.style = next; break;
      case "style-hint": args.styleHint = next; break;
      case "template": args.template = next; break;
      default: throw new Error(`Unknown option --${key}.`);
    }
  }
  return args;
}

async function uploadAttachment(baseUrl, filePath, sessionId, allowedExtensions) {
  const extension = extensionOf(filePath);
  if (!allowedExtensions.has(extension)) throw new Error(`Unsupported upload file '${filePath}'.`);

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
  node scripts/generate-ppt.mjs --prompt "..." [options]

Options:
  --base-url URL       Service base URL. Defaults to PPT_SVG_BASE_URL or ${DEFAULT_BASE_URL}.
  --language en|zh     Output language. Defaults to en.
  --style ID           Built-in style. Defaults to tech.
  --style-hint TEXT    Small visual refinement applied after the selected style.
  --source PATH        Upload a source document or image. Repeat as needed.
  --template PATH      Upload a .pptx template; it overrides the built-in style.
  --session ID         Optional session ID.
  --out PATH           PPTX output path. Defaults to presentation.pptx.
  --json PATH          Write deck JSON and metadata without embedded PPTX bytes.
  --help               Show this help.

Styles:
  ${Array.from(VALID_STYLES).join(", ")}
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
