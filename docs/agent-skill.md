# Hermes / OpenClaw Skill

PPT-SVG has two runtime forms:

- Web app: the current Next.js UI and API keep running as before.
- Agent skill: Hermes or OpenClaw calls the same API through `SKILL.md` and `scripts/ppt-svg-agent.mjs`.

## Install

```bash
cd /dev/ppt-svg/PPT-SVG
bash scripts/install-agent-skill.sh hermes
bash scripts/install-agent-skill.sh openclaw
```

The install script copies only the skill instructions and the small CLI wrapper. It does not copy API keys.

It also does not copy the full Next.js app. For local generation with a user-owned API key, keep a PPT-SVG checkout available and set `PPT_SVG_PROJECT_DIR` if the Agent does not already know that path.

## Use A User-Owned API Key

Run the PPT-SVG service locally with one of these environment sets:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=google/gemini-2.5-flash
```

or:

```bash
PPT_SVG_LLM_API_KEY=...
PPT_SVG_LLM_MODEL=...
PPT_SVG_LLM_BASE_URL=https://api.openai.com/v1
```

Then start the app:

```bash
cd "$PPT_SVG_PROJECT_DIR"
npm install
npm run dev
```

The default agent base URL is `http://127.0.0.1:3000/ppt`. Override it with:

```bash
export PPT_SVG_BASE_URL=http://127.0.0.1:3000/ppt
```

## Generate From The CLI

```bash
node scripts/ppt-svg-agent.mjs \
  --language zh \
  --skill freeform \
  --prompt "生成一页产品路线图，包含 Q1 调研、Q2 MVP、Q3 公测、Q4 商用" \
  --json /tmp/ppt-svg-response.json \
  --bundle /tmp/ppt-svg-export.zip
```

The bundle contains `figure.svg`, `figure.pptx`, `figure.json`, and `metadata.json`.
