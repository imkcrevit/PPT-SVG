import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = normalizeBaseUrl(process.env.BASE_URL || process.argv[2] || "http://127.0.0.1:3001/ppt");
const now = Date.now();
const sessions = [
  {
    sessionId: `check-session-alpha-${now}`,
    requestId: `req-alpha-${now}`,
    title: "Alpha Session Result",
    score: 0.91
  },
  {
    sessionId: `check-session-beta-${now}`,
    requestId: `req-beta-${now}`,
    title: "Beta Session Result",
    score: 0.72
  },
  {
    sessionId: `check-session-gamma-${now}`,
    requestId: `req-gamma-${now}`,
    title: "Gamma Session Result",
    score: 0.83
  }
];

await Promise.all(sessions.map(writeLatestArtifact));

const results = await Promise.all(sessions.map(fetchAndAssertLatest));
for (const result of results) {
  console.log(
    `PASS ${result.sessionId}: requestId=${result.requestId}, title="${result.title}", score=${result.score}`
  );
}

console.log(`Checked ${results.length} concurrent session lookups against ${baseUrl}.`);

async function writeLatestArtifact({ sessionId, requestId, title, score }) {
  const sessionDirectory = path.join("/tmp", "ppt-svg", "sessions", sessionId);
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    path.join(sessionDirectory, "latest.json"),
    `${JSON.stringify(
      {
        sessionId,
        requestId,
        figure: {
          canvas: {
            width: 1280,
            height: 720,
            background: "#ffffff"
          },
          metadata: {
            title,
            description: `Fixture for ${sessionId}`,
            skillId: "freeform",
            language: "en"
          },
          elements: []
        },
        fit: {
          score,
          note: `Fixture score for ${sessionId}`
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function fetchAndAssertLatest(expected) {
  const url = `${baseUrl}/api/sessions/${encodeURIComponent(expected.sessionId)}/latest`;
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load ${url}: ${detail}. Start the app first, for example: PORT=3001 npm run dev`);
  }

  const bodyText = await response.text();
  let payload;

  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error(`Expected JSON from ${url}, got HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`Expected HTTP 200 from ${url}, got ${response.status}: ${JSON.stringify(payload)}`);
  }

  const actual = {
    sessionId: payload.sessionId,
    requestId: payload.requestId,
    title: payload.figure?.metadata?.title,
    score: payload.fit?.score
  };

  for (const key of Object.keys(actual)) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `Session ${expected.sessionId} returned wrong ${key}: expected ${JSON.stringify(
          expected[key]
        )}, got ${JSON.stringify(actual[key])}`
      );
    }
  }

  return actual;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

