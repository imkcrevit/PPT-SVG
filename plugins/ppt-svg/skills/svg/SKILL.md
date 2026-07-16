---
name: svg
description: Create or revise one source-grounded SVG diagram, flowchart, architecture map, matrix, timeline, or other presentation visual, with optional JSON and editable one-slide PPTX export. Use for a single visual, for diagram-engine work in the PPT-SVG repository, or when the ppt skill needs a diagram slide. Hand multi-slide presentation requests to the ppt skill.
---

# SVG

Create one clear visual through the PPT-SVG semantic diagram engine. Treat uploaded documents and images as the factual source; use the user's message to choose scope, emphasis, diagram type, and revisions.

## Choose the workflow

- For one diagram or chart, stay in this skill.
- For a whole presentation or multiple slides, invoke `$ppt` and let it call the SVG engine for diagram slides.
- In the PPT-SVG repository, work through the public `@/features/svg` contract. Read [references/repository.md](references/repository.md) before changing code.
- Outside the repository, use `scripts/generate-svg.mjs` against the hosted service or a user-configured local deployment.

## Ground the visual

1. Inspect every source the user selected. Do not search for replacement facts unless they explicitly request outside research.
2. Build a private evidence list of exact entities, labels, numbers, dates, ordering, hierarchy, and relationships present in the sources.
3. Keep each substantive node and connector traceable to that evidence list. Do not add plausible intermediate steps, metrics, actors, or conclusions.
4. Preserve source wording for labels when it fits. If a short quotation is useful, copy one contiguous excerpt exactly and attribute its filename; never reconstruct a quote.
5. Prefer an uploaded original image when it already contains the requested visual evidence. Do not redraw it merely to make the output look more uniform.
6. If the evidence is insufficient for a requested relationship, either omit that relationship or ask one focused question.

## Generate with the bundled client

The hosted default is `https://labs.graptolite.ai/ppt`. Set `PPT_SVG_BASE_URL` to use another deployment. Files passed with `--source` are uploaded to that service, so use a local deployment for confidential material and never upload secrets without the user's authorization.

```bash
node scripts/generate-svg.mjs \
  --language zh \
  --skill flow \
  --prompt "只根据资料中的审批顺序绘制流程图，并保留一处原文短引" \
  --source ./source.pdf \
  --bundle ./approval-flow.zip \
  --json ./approval-flow.json
```

Supported diagram IDs are `freeform`, `flow`, `matrix`, `timeline`, `pyramid`, `architecture`, `hierarchy`, `cycle`, `funnel`, `venn`, `mindmap`, `fishbone`, `gantt`, `swimlane`, `scatter`, `kanban`, `network`, `radar`, `heatmap`, and `waterfall`.

The bundle contains the SVG, semantic figure JSON, metadata, and an editable one-slide PPTX. Return the output paths plus the request and session IDs.

## Revise and validate

- Preserve correct parts of the current visual when the user asks for a revision; do not restart conceptually unless asked.
- Check for clipped text, overlaps, connectors crossing labels, missing source items, unsupported claims, and language drift.
- Confirm that quoted wording is byte-for-byte present in the selected source.
- If a whole deck becomes necessary, pass the grounded evidence and selected visual intent to `$ppt`; do not duplicate the deck pipeline here.
