---
name: ppt-svg
description: Generate single-slide presentation visuals as SVG, JSON, or editable PPTX through a local or deployed PPT-SVG service. Use when the user asks for a diagram, flowchart, architecture slide, roadmap, matrix, timeline, or PowerPoint-ready visual.
---

# PPT-SVG

Use this skill to create one-slide presentation visuals through the PPT-SVG app backend.

## Runtime Shape

- Preserve the two forms: the Web app remains the source of truth, and this skill calls the same service instead of reimplementing generation.
- Prefer a local PPT-SVG service when the user wants to use their own API key.
- Do not ask the user to paste API keys into chat. Use environment variables in the service process.
- Keep generated exports as artifacts; avoid rewriting the app, prompt files, or UI unless the user explicitly asks.

## Configure User API

The service accepts the existing OpenRouter variables:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=google/gemini-2.5-flash
```

It also accepts an OpenAI-compatible setup for local Hermes/OpenClaw installs:

```bash
PPT_SVG_LLM_API_KEY=...
PPT_SVG_LLM_MODEL=...
PPT_SVG_LLM_BASE_URL=https://api.openai.com/v1
```

If the user already has OpenAI environment variables, the service can use:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=...
OPENAI_BASE_URL=https://api.openai.com/v1
```

## Start Service

If `PPT_SVG_BASE_URL` is set and reachable, use it. Otherwise, run the full PPT-SVG project checkout. The installed skill directory only contains the wrapper; do not run `npm install` there.

```bash
cd "$PPT_SVG_PROJECT_DIR"
npm install
npm run dev
```

If `PPT_SVG_PROJECT_DIR` is not set, locate the checkout that contains `package.json` with `"name": "ppt-svg"`, then use that path.

The default local base URL is `http://127.0.0.1:3000/ppt`.

## Generate

Use the bundled CLI. If the runtime supports `{baseDir}`, resolve the script as `{baseDir}/scripts/ppt-svg-agent.mjs`; otherwise run it from the installed skill directory.

```bash
node scripts/ppt-svg-agent.mjs \
  --language zh \
  --skill freeform \
  --prompt "生成一页产品路线图，包含 Q1 调研、Q2 MVP、Q3 公测、Q4 商用" \
  --bundle /tmp/ppt-svg-export.zip
```

Useful options:

- `--base-url`: override `PPT_SVG_BASE_URL`.
- `--language`: `en` or `zh`.
- `--skill`: `freeform`, `flow`, `matrix`, `timeline`, `pyramid`, `architecture`, `hierarchy`, `cycle`, `funnel`, `venn`, `mindmap`, `fishbone`, `gantt`, `swimlane`, or `scatter`.
- `--json`: write the raw generation response.
- `--bundle`: write a zip containing `figure.svg`, `figure.pptx`, `figure.json`, and `metadata.json`.

Return the generated file path, title, session ID, request ID, and any service error clearly to the user.
