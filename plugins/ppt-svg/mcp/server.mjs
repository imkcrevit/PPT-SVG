#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000/ppt";
const SOURCE_EXTENSIONS = new Set(["pdf", "doc", "docx", "pptx", "md", "png", "jpg", "jpeg"]);
const SKILLS = [
  ["freeform", "Other / AI choice", "Choose the best visual structure from the supplied content."],
  ["flow", "Flowchart", "Ordered process steps and handoffs."],
  ["matrix", "Matrix", "Quadrants, segmentation, and prioritization."],
  ["timeline", "Timeline", "Milestones, dates, and roadmaps."],
  ["pyramid", "Pyramid", "Layered hierarchy and maturity levels."],
  ["architecture", "Architecture", "Systems, services, and platform layers."],
  ["hierarchy", "Hierarchy", "Organization charts and parent-child trees."],
  ["cycle", "Cycle", "Closed-loop processes such as PDCA."],
  ["funnel", "Funnel", "Conversion or narrowing stages."],
  ["venn", "Venn diagram", "Overlapping sets."],
  ["mindmap", "Mind map", "A central topic with branches."],
  ["fishbone", "Fishbone", "Cause-and-effect analysis."],
  ["gantt", "Gantt chart", "Tasks over a schedule."],
  ["swimlane", "Swimlane", "Processes split across roles or teams."],
  ["scatter", "Scatter plot", "Points positioned by two numeric values."],
  ["kanban", "Kanban", "Cards grouped into status columns."],
  ["network", "Network", "Entities linked by relationships."],
  ["radar", "Radar chart", "Multi-dimensional numeric scores."],
  ["heatmap", "Heatmap", "Grid values represented by intensity."],
  ["waterfall", "Waterfall chart", "Cumulative increases and decreases."],
  ["pie", "Pie / donut chart", "Composition, share, and percentage breakdowns."],
  ["bar", "Bar / column chart", "Numeric comparison across categories."],
  ["line", "Line chart", "Ordered numeric change and trends over time."]
];

const TOOLS = SKILLS.map(([id, title, description]) => ({
  name: `render_${id}_svg`,
  title: `Render ${title}`,
  description: `${description} Generates a source-grounded SVG through the PPT-SVG semantic engine.`,
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The complete user request and factual content to visualize." },
      language: { type: "string", enum: ["en", "zh"], default: "en" },
      source_paths: {
        type: "array",
        items: { type: "string" },
        maxItems: 3,
        description: "Optional local source files to upload to the configured PPT-SVG service."
      },
      session_id: { type: "string", description: "Optional stable session ID for revisions." },
      conversation_turn: { type: "integer", minimum: 1, maximum: 5, default: 1 },
      base_url: { type: "string", description: "Optional operator-approved service URL; defaults to PPT_SVG_BASE_URL or the local PPT-SVG service." }
    },
    required: ["prompt"],
    additionalProperties: false
  },
  annotations: {
    title: `Render ${title}`,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  }
}));

const toolSkill = new Map(SKILLS.map(([id]) => [`render_${id}_svg`, id]));

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  void receive(line);
});

async function receive(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    writeError(null, -32700, "Parse error");
    return;
  }

  if (request.id === undefined || request.id === null) return;

  try {
    const result = await handle(request.method, request.params ?? {});
    write({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    writeError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

async function handle(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion || "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ppt-svg-diagrams", version: "0.1.0" }
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") return callTool(params);
  throw new Error(`Method not found: ${method}`);
}

async function callTool(params) {
  const skillId = toolSkill.get(params.name);
  if (!skillId) throw new Error(`Unknown PPT-SVG tool: ${params.name}`);

  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const language = args.language === "zh" ? "zh" : "en";
  const turn = Number.isInteger(args.conversation_turn) ? args.conversation_turn : 1;
  const sourcePaths = Array.isArray(args.source_paths) ? args.source_paths : [];
  const sessionId = typeof args.session_id === "string" && args.session_id.trim()
    ? args.session_id.trim()
    : `mcp-svg-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const baseUrl = normalizeBaseUrl(
    (typeof args.base_url === "string" && args.base_url) || process.env.PPT_SVG_BASE_URL || DEFAULT_BASE_URL
  );

  if (!prompt) throw new Error("prompt is required.");
  if (turn < 1 || turn > 5) throw new Error("conversation_turn must be from 1 to 5.");
  if (sourcePaths.length > 3) throw new Error("At most three source_paths are supported.");

  const attachments = [];
  for (const sourcePath of sourcePaths) {
    if (typeof sourcePath !== "string") throw new Error("Every source_paths entry must be a string.");
    attachments.push(await uploadAttachment(baseUrl, sourcePath, sessionId));
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
  const summary = {
    title: generated.figure?.metadata?.title,
    skillId: generated.figure?.metadata?.skillId ?? skillId,
    mcpTool: params.name,
    requestId: generated.requestId,
    sessionId: generated.sessionId || sessionId,
    fit: generated.fit,
    routing: generated.routing,
    artifacts: generated.artifacts,
    figure: generated.figure
  };

  return {
    content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    structuredContent: summary
  };
}

async function uploadAttachment(baseUrl, filePath, sessionId) {
  const extension = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (!SOURCE_EXTENSIONS.has(extension)) throw new Error(`Unsupported source file: ${filePath}`);

  const bytes = await readFile(path.resolve(filePath));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeTypeFor(extension) }), path.basename(filePath));
  form.append("sessionId", sessionId);
  form.append("conversationId", sessionId);
  const response = await fetch(`${baseUrl}/api/attachments`, { method: "POST", body: form });
  const data = await responseJson(response, `${baseUrl}/api/attachments`);
  if (!response.ok || !data.attachment) throw new Error(data.error || `Upload failed with status ${response.status}.`);
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
  const data = await responseJson(response, url);
  if (!response.ok) {
    const details = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
    throw new Error(`${data.error || data.message || `Request failed with status ${response.status}.`}${details}`);
  }
  return data;
}

async function responseJson(response, url) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response from ${url} was not valid JSON.`);
  }
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
  return String(value).trim().replace(/\/+$/, "");
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeError(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}
