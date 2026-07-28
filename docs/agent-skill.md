# SVG and PPT Skills

PPT-SVG now ships as two interoperable skills:

- `$svg` creates or revises one grounded SVG visual and can export JSON plus an editable one-slide PPTX.
- `$ppt` creates a complete grounded PPTX deck and delegates every diagram slide to the SVG engine.

Both use the same web/API implementation as the two independent UI pages. They prioritize selected source files, preserve exact short quotations, reuse uploaded original images, and avoid unsupported content expansion.

The plugin also registers the `ppt-svg-diagrams` MCP server. It exposes one `render_<type>_svg` tool per supported diagram type, including pie, bar, and line charts. Explicit user formats are routed directly; ambiguous requests can be resolved through an AI tool call before the selected internal skill generates the semantic diagram.

## Install from the repository marketplace

### Codex

After this repository is public or otherwise accessible to the user:

```bash
codex plugin marketplace add imkcrevit/PPT-SVG --ref main
codex plugin add ppt-svg@graptolite-labs
```

The Codex marketplace lives at `.agents/plugins/marketplace.json`; the plugin manifest is `plugins/ppt-svg/.codex-plugin/plugin.json`. Invoke the installed skills as `$svg` and `$ppt`.

### Claude Code

```bash
claude plugin marketplace add imkcrevit/PPT-SVG
claude plugin install ppt-svg@graptolite-labs
```

The Claude Code marketplace lives at `.claude-plugin/marketplace.json`; its plugin manifest is `plugins/ppt-svg/.claude-plugin/plugin.json`. Invoke the installed skills as `/ppt-svg:svg` and `/ppt-svg:ppt`.

## Install for Hermes or OpenClaw

```bash
bash scripts/install-agent-skill.sh hermes
bash scripts/install-agent-skill.sh openclaw
```

The installer creates separate `svg` and `ppt` skill directories. It copies no API keys.

## Service selection and privacy

The bundled clients default to the hosted service:

```bash
export PPT_SVG_BASE_URL=https://labs.graptolite.ai/ppt
```

Source files passed to a client are uploaded to the configured service. For confidential material, run the app locally and point the skills at it:

```bash
export PPT_SVG_BASE_URL=http://127.0.0.1:3000/ppt
```

The service accepts `OPENROUTER_*`, `PPT_SVG_LLM_*`, or `OPENAI_*` environment variables. Keep keys in the service process; never paste them into a skill prompt.

## Generate one SVG visual

```bash
node plugins/ppt-svg/skills/svg/scripts/generate-svg.mjs \
  --language zh \
  --skill flow \
  --prompt "仅根据资料画审批流程，并保留一处原文短引" \
  --source ./source.pdf \
  --bundle ./approval-flow.zip
```

## Generate a complete PPTX

```bash
node plugins/ppt-svg/skills/ppt/scripts/generate-ppt.mjs \
  --language zh \
  --style corporate \
  --prompt "将资料整理成管理层汇报，优先使用原图" \
  --source ./report.pdf \
  --out ./management-report.pptx
```

Use `--template ./brand-template.pptx` to apply an uploaded PowerPoint template. Run either client with `--help` for all options.
