---
name: ppt
description: Create or revise a complete multi-slide PPTX presentation from uploaded documents, images, pasted context, or a PPTX template. Use for whole-deck requests, document-to-deck conversion, presentation styles, slide sequencing, source quotations, and original-image reuse. Compose the svg skill for every diagram slide, and hand single-visual-only requests to svg.
---

# PPT

Create a complete presentation whose claims, structure, short quotations, and images remain grounded in the user's selected source material. Text slides carry the narrative; every diagram slide is compiled through the same SVG engine used by the `svg` skill.

## Choose the workflow

- For a complete deck, multiple slides, or an uploaded PPTX template, stay in this skill.
- For only one flowchart, architecture diagram, matrix, timeline, or presentation visual, invoke the `svg` skill.
- In the PPT-SVG repository, work through `@/features/deck` and its one-way bridge to `@/features/svg`. Read [references/repository.md](references/repository.md) before changing code.
- Outside the repository, use `scripts/generate-ppt.mjs` against the hosted service or a user-configured local deployment.

## Build a source-grounded deck

1. Inspect all selected files before outlining. Separate source facts from the user's presentation instructions.
2. Build a private evidence list: themes, exact entities, numbers, dates, causal or ordered relationships, candidate contiguous quotations, and reusable original images.
3. Create the smallest coherent slide sequence supported by that evidence. Do not pad the deck with generic industry content.
4. Use 1–3 short verbatim excerpts only when the source contains representative complete sentences. Copy them exactly, keep them short, and attribute the filename. Never put quotation marks around a paraphrase.
5. Prefer uploaded original images when they directly support a slide. Use an SVG diagram only when the source explicitly supplies a process, hierarchy, comparison, timeline, role split, or relationship that benefits from visualization.
6. Preserve the source's node count, names, direction, order, and relationships in diagram slides. Invoke the `svg` skill and its matching `render_<type>_svg` MCP tool for generation or repair; do not reimplement diagram layout inside this skill.
7. If information is missing, reduce scope or ask a focused question. Never invent metrics, milestones, roles, customer quotes, citations, or conclusions.

## Generate with the bundled client

The hosted default is `https://labs.graptolite.ai/ppt`. Set `PPT_SVG_BASE_URL` to use another deployment. Files passed with `--source` or `--template` are uploaded to that service, so use a local deployment for confidential material and never upload secrets without the user's authorization.

```bash
node scripts/generate-ppt.mjs \
  --language zh \
  --style corporate \
  --prompt "制作一套管理层汇报，严格围绕上传资料，引用两处原文并优先使用原图" \
  --source ./report.pdf \
  --source ./evidence.png \
  --out ./management-report.pptx \
  --json ./management-report.json
```

Use `--template ./brand-template.pptx` when the user supplies a PowerPoint template. Built-in style IDs are `tech`, `corporate`, `academic`, `government`, `nature`, `creative`, and `minimal`; an uploaded template takes precedence. Use `--style-hint` only for a small refinement such as “more whitespace” or “more restrained.”

## Review before delivery

- Verify slide order, cover/title consistency, source fidelity, exact quotations, and image relevance.
- Check that every diagram slide is readable and grounded, and that no source relationship was silently added or removed.
- Report the PPTX path, slide count, title, request ID, warnings, and optional JSON path.
- If the user later asks for one diagram as a standalone asset, invoke `$svg` with the same evidence rather than extracting a lower-quality screenshot from the deck.
