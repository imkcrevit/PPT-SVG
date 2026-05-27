# Repository Guidelines

## Project Structure & Module Organization

PPT-SVG is a Next.js TypeScript app that generates single-slide presentation visuals as JSON and SVG.

- `app/` contains App Router pages and API routes, including `app/api/generate/route.ts`.
- `src/components/` contains React UI, including the workspace and SVG renderer.
- `src/lib/` contains shared logic: prompt loading, validation, OpenRouter calls, PPTX helpers, i18n, and types.
- `prompt/` contains system, skill, and shared prompt Markdown files loaded by the server.
- `deploy/` contains optional Nginx and systemd examples.
- `.env.example` documents required local environment variables.

Do not edit generated directories such as `.next/` or `node_modules/`.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `cp .env.example .env.local` creates local config; set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`.
- `./scripts/start.sh dev` starts the Next.js dev server after clearing `PORT` (`3000` by default) and defaults to `NEXT_PUBLIC_BASE_PATH=/ppt`.
- `./scripts/start.sh debug` starts the dev server with Node inspector enabled.
- `./scripts/start.sh prod` serves the production build.
- `./scripts/start.sh stop` clears the active local service on `PORT` without starting a new server.
- `npm run dev`, `npm run debug`, `npm run start`, and `npm run stop` delegate to `scripts/start.sh`.
- `npm run lint` runs ESLint with Next.js rules.
- `npm run typecheck` runs `tsc --noEmit` under strict TypeScript settings.
- `npm run build` creates a production Next.js build with `/ppt` as the default base path.

For nginx reverse-proxy testing, keep the complete `/ppt` path. On port `3000`, verify `http://127.0.0.1:3000/ppt/zh` and `http://127.0.0.1:3000/ppt/en`; do not use or document shortened `/zh` or `/en` paths for this deployment shape. To build without a base path, explicitly run `NEXT_PUBLIC_BASE_PATH= npm run build`. To bind another host or port, use `BIND_HOST=0.0.0.0 PORT=3001 ./scripts/start.sh dev`. Port `3000` is the nginx upstream app port; the script may stop `ppt-svg.service` before manual local launches, but it must not stop nginx itself.

## Start Script Rule

All manual and automated local launches must start through `./scripts/start.sh` or an npm script that delegates to it. This keeps nginx-upstream port cleanup, `/ppt` base-path setup, and startup behavior consistent for debugging, production runs, browser checks, and test automation. Use `./scripts/start.sh stop` before tests that need a clear `3000` port. Use another startup method only when the task cannot work through this script; document the reason in the command output or PR notes.

## Prompt & Skill Rules

All internal skill prompts must live under `prompt/skills/*.md` and be loaded through `src/lib/prompts.ts`; do not hardcode skill prompts outside `PPT-SVG/prompt`.

The context compression agent prompt lives at `prompt/system/compress-context.md`. It must produce dense downstream context from the user prompt and attachment metadata/text before figure generation.

Generated SVG figure colors do not need to match the main website UI. Keep diagrams business-appropriate and avoid decorative side symbols, edge icons, corner marks, ornamental badges, and standalone symbols unless the user explicitly asks for them.

Attachments must be stored under hash-coded file names in `/tmp/ppt-svg/uploads/<YYYY-MM-DD>/`. When `MONGODB_URI` is configured, record conversations and attachment file paths in MongoDB.

The active UI locale controls output language: `zh` must produce Simplified Chinese labels, titles, notes, and metadata; `en` must produce English. Only switch language when the user explicitly requests another language.

Text, step numbers, and content labels placed on a background shape must be horizontally and vertically centered against that shape. If a number and label share one background, align the combined group to the visual center.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Keep strict typing and prefer explicit interfaces for shared data. Use the `@/*` import alias for `src/`.

Follow the existing style: 2-space indentation, double quotes, semicolons, named exports, and PascalCase for React components. Use camelCase for functions, variables, and state values. Keep prompt skill IDs and locale strings aligned with `src/lib/types.ts`.

## Testing Guidelines

There is currently no dedicated unit or end-to-end test runner configured. Before submitting changes, run:

```bash
npm run lint
npm run typecheck
npm run build
```

For UI changes, verify both locale routes manually. For prompt, validation, or API changes, test generation with real OpenRouter config.

## Commit & Pull Request Guidelines

The history uses short imperative summaries, for example `Build PPT-SVG app` and `add sop file`. Keep commits focused and concise.

Pull requests should include a description, verification commands, linked issue if applicable, and screenshots or recordings for UI changes. Note environment or deployment impacts, especially changes involving `OPENROUTER_*`, `NEXT_PUBLIC_BASE_PATH`, prompts, or generated SVG behavior.

## Security & Configuration Tips

Do not commit real API keys or local secrets. Keep `.env.local` private and update `.env.example` when adding required configuration. Treat prompt files as server-loaded application inputs; review changes there with the same care as code.
