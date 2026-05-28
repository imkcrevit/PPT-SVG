# PPT-SVG

PPT-SVG generates single-slide presentation visuals as structured JSON and renders them as high-quality SVG. The first version uses internal skills only and calls LLMs through OpenRouter.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000/en` or `http://localhost:3000/zh`.

Nginx is not required. The app runs normally on the Next.js dev or production server at port `3000`.

## Environment

```bash
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=PPT-SVG
MONGODB_URI=
MONGODB_DB=ppt_svg
```

`OPENROUTER_MODEL` controls the active model. Use any OpenRouter chat model, including Gemini, GPT, DeepSeek, and Claude model IDs.
`MONGODB_URI` is optional. When configured, conversations and hash-coded attachment paths are recorded in MongoDB.

## V1 Scope

- Internal skills: flow, matrix, timeline, pyramid, architecture.
- Prompt files live in `/prompt` and are loaded by the server.
- SVG export serializes the current browser preview as a standalone vector file.
- PPTX export writes the generated figure to the first slide as editable PowerPoint shapes.
- External skills, GitHub skill URLs, AI-created skills, and uploaded `SKILL.md` files are intentionally out of the first UI surface.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Optional Reverse Proxy

The app can be served from a subpath such as `/ppt` by setting `NEXT_PUBLIC_BASE_PATH=/ppt` at build and runtime. This is only needed for reverse-proxy deployments like `labs.graptolite.ai/ppt`.

Example Nginx and systemd files live in `deploy/`. They are deployment examples, not required for local development or for running the project directly on `localhost:3000`.
