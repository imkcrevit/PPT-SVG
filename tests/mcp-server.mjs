import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

let receivedGeneration;
const api = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    if (request.method !== "POST" || request.url !== "/api/generate") {
      response.writeHead(404).end();
      return;
    }
    receivedGeneration = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      requestId: "mcp-test",
      sessionId: receivedGeneration.sessionId,
      fit: { score: 1, note: "test" },
      routing: { protocol: "mcp", toolName: "render_pie_svg", skillId: "pie", source: "user-selection" },
      figure: {
        canvas: { width: 1280, height: 720, background: "#FFFFFF" },
        metadata: { title: "Test pie", description: "Test", skillId: "pie", language: "zh" },
        elements: []
      }
    }));
  });
});

await new Promise((resolve, reject) => {
  api.once("error", reject);
  api.listen(0, "127.0.0.1", resolve);
});
const address = api.address();
if (!address || typeof address === "string") throw new Error("Could not start fake PPT-SVG API.");

const child = spawn(process.execPath, [path.resolve("plugins/ppt-svg/mcp/server.mjs"), "--stdio"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"]
});
const pending = new Map();
const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
output.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

let nextId = 1;
function rpc(method, params = {}) {
  const id = nextId++;
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}`));
    }, 5000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); }
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return result;
}

let allPass = true;
function check(name, condition) {
  allPass = allPass && condition;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
}

try {
  const initialized = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  check("MCP initialize", initialized.serverInfo?.name === "ppt-svg-diagrams");

  const listed = await rpc("tools/list");
  const names = listed.tools?.map((tool) => tool.name) ?? [];
  check("one MCP tool per diagram skill", names.length === 23 && new Set(names).size === 23);
  check("pie, bar, and line MCP tools are exposed", ["render_pie_svg", "render_bar_svg", "render_line_svg"].every((name) => names.includes(name)));

  const called = await rpc("tools/call", {
    name: "render_pie_svg",
    arguments: {
      prompt: "生成渠道占比饼图：直营 50，伙伴 30，线上 20",
      language: "zh",
      base_url: `http://127.0.0.1:${address.port}`
    }
  });
  check("MCP tool dispatches the selected skill", receivedGeneration?.skillId === "pie");
  check("MCP tool returns structured figure data", called.structuredContent?.figure?.metadata?.skillId === "pie");
} finally {
  child.kill("SIGTERM");
  output.close();
  await new Promise((resolve) => api.close(resolve));
}

console.log(allPass ? "\nMCP SERVER ASSERTIONS PASS" : "\nMCP SERVER ASSERTIONS FAILED");
if (!allPass) process.exitCode = 1;
