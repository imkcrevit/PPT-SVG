# Repository Guidelines

## Project Structure & Module Organization

PPT-SVG is a Next.js TypeScript app that generates single-slide presentation visuals as JSON and SVG.

- `app/` contains App Router pages and API routes, including `app/api/generate/route.ts`.
- `src/components/` contains React UI, including the workspace and SVG renderer.
- `src/lib/` contains shared logic: prompt loading, validation, OpenRouter calls, PPTX helpers, i18n, and types.
- `src/lib/theme.ts` defines the deterministic diagram theme model, default palette, user override normalization, and merge behavior.
- `src/lib/theme-extract.ts` extracts diagram themes from uploaded PPTX files and images.
- `prompt/` contains system, skill, and shared prompt Markdown files loaded by the server.
- `deploy/` contains optional Nginx and systemd examples.
- `.env.example` documents required local environment variables.
- `tmps/` is the SFTP upload landing area for temporary review bundles. It may be owned by `sftp_upload` with restrictive permissions.

Do not edit generated directories such as `.next/` or `node_modules/`.

## Review Upload Workflow

When the user says they uploaded review material, locate the current SFTP upload folder (`tmps/`, usually `PPT-SVG/tmps/`), find the newest `.zip` by modification time, then copy it into a readable working location under the project `tmps/` area before extracting and reading it. The upload directory and zip files may require escalated permissions because they can be owned by `sftp_upload`.

Do not assume the newest review content is already extracted. After copying the latest zip, unzip it into a clearly named directory, inspect the included README or integration notes first, and then apply the requested review changes from that extracted copy.

When an uploaded bundle includes replacement files, compare them against the current working tree before copying. Preserve local fixes that landed after the bundle was produced, especially validation, layout tests, package scripts, and deployment notes. Treat bundled previews as evidence, but do not commit preview images unless the user explicitly asks for them.

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
- `npm run test:layout` runs layout-level assertions through the semantic validation and deterministic layout pipeline. This catches dropped semantic fields such as `lane`, `lanes`, `start`, `end`, `score`, and `axes`.
- `npm run test:snapshots` runs deterministic SVG snapshot checks for the core semantic layout engine.
- `npm run build` creates a production Next.js build with `/ppt` as the default base path.

For nginx reverse-proxy testing, keep the complete `/ppt` path. On port `3000`, verify `http://127.0.0.1:3000/ppt/zh` and `http://127.0.0.1:3000/ppt/en`; do not use or document shortened `/zh` or `/en` paths for this deployment shape. To build without a base path, explicitly run `NEXT_PUBLIC_BASE_PATH= npm run build`. To bind another host or port, use `BIND_HOST=0.0.0.0 PORT=3001 ./scripts/start.sh dev`. Port `3000` is the nginx upstream app port; the script may stop `ppt-svg.service` before manual local launches, but it must not stop nginx itself.

## Start Script Rule

All manual and automated local launches must start through `./scripts/start.sh` or an npm script that delegates to it. This keeps nginx-upstream port cleanup, `/ppt` base-path setup, and startup behavior consistent for debugging, production runs, browser checks, and test automation. Use `./scripts/start.sh stop` before tests that need a clear `3000` port. Use another startup method only when the task cannot work through this script; document the reason in the command output or PR notes.

## Prompt & Skill Rules

All internal skill prompts must live under `prompt/skills/*.md` and be loaded through `src/lib/prompts.ts`; do not hardcode skill prompts outside `PPT-SVG/prompt`.

The context compression agent prompt lives at `prompt/system/compress-context.md`. It must produce dense downstream context from the user prompt and attachment metadata/text before figure generation.

Generated SVG figure colors do not need to match the main website UI. Keep diagrams business-appropriate and avoid decorative side symbols, edge icons, corner marks, ornamental badges, and standalone symbols unless the user explicitly asks for them.

Attachments must be stored under hash-coded file names in `/tmp/ppt-svg/uploads/<YYYY-MM-DD>/`. When `MONGODB_URI` is configured, record conversations and attachment file paths in MongoDB. Attachment metadata may include an extracted diagram theme, but generation should still resolve theme from the stored attachment file path so sanitized request metadata cannot forge local file contents.

## Diagram Theme Rules

The theme system is deterministic and server-side. The model must not emit colors, fonts, or coordinates.

- Default diagram font is `Microsoft YaHei`.
- `figure.canvas.fontFamily` is the single font value consumed by SVG, React preview, and PPTX export.
- `figure.canvas.background` should come from the resolved theme unless a caller explicitly supplies a canvas background.
- `themeOverride` in `/api/generate` or `/api/generate-agent` is optional and must be sanitized with `normalizeThemeOverride`.
- Automatic extraction comes from uploaded PPTX `ppt/theme/theme*.xml` first, then image dominant colors through `sharp`.
- Merge order is: default theme → uploaded attachment theme → user `themeOverride`.
- User override wins only for fields it supplies; missing fields must keep the extracted theme or default.
- Keep SVG and PPTX font fallback chains conservative: theme font, `Microsoft YaHei`, Chinese system fonts, then generic sans-serif.

For frontend changes, if a manual theme control is exposed, the generated request body must pass `themeOverride: override ?? undefined`. Resetting a conversation should reset manual theme overrides.

The active UI locale controls output language: `zh` must produce Simplified Chinese labels, titles, notes, and metadata; `en` must produce English. Only switch language when the user explicitly requests another language.

Text, step numbers, and content labels placed on a background shape must be horizontally and vertically centered against that shape. If a number and label share one background, align the combined group to the visual center.

## Semantic Layout Rules

The semantic pipeline is the source of truth for mainstream diagrams. New semantic layouts must return finished `Figure` output and must not be passed through the legacy coordinate normalizer.

- `validateAndNormalizeSemanticDiagram` must preserve all semantic fields needed by layout functions: `parent`, `lane`, `start`, `end`, `score`, `axes`, and `lanes`.
- `layoutDiagram()` should dispatch special diagram types early to `layout-extra.ts`.
- Legacy `validateAndNormalizeFigureResponse` is only for legacy figure-shaped model output, not semantic layout output.
- When adding or changing validation or layout behavior, run `npm run test:layout` before build.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Keep strict typing and prefer explicit interfaces for shared data. Use the `@/*` import alias for `src/`.

Follow the existing style: 2-space indentation, double quotes, semicolons, named exports, and PascalCase for React components. Use camelCase for functions, variables, and state values. Keep prompt skill IDs and locale strings aligned with `src/lib/types.ts`.

## Testing Guidelines

There is currently no dedicated unit or end-to-end test runner configured. Before submitting changes, run:

```bash
npm run test:layout
npm run test:snapshots
npm run lint
npm run typecheck
npm run build
```

For UI changes, verify both locale routes manually. For prompt, validation, theme, or API changes, test generation with real OpenRouter config. After restarting the production service on port `3000`, verify `http://127.0.0.1:3000/ppt/zh` returns `200 OK`.

## Commit & Pull Request Guidelines

The history uses short imperative summaries, for example `Build PPT-SVG app` and `add sop file`. Keep commits focused and concise.

Pull requests should include a description, verification commands, linked issue if applicable, and screenshots or recordings for UI changes. Note environment or deployment impacts, especially changes involving `OPENROUTER_*`, `NEXT_PUBLIC_BASE_PATH`, prompts, or generated SVG behavior.

## Security & Configuration Tips

Do not commit real API keys or local secrets. Keep `.env.local` private and update `.env.example` when adding required configuration. Treat prompt files as server-loaded application inputs; review changes there with the same care as code.
