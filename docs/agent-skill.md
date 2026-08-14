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

### DeepSeek Harness (DSH)

Install the local bundle into a profile and inspect the effective configuration before booting it:

```bash
dsh plugin --profile default add ./plugins/ppt-svg
dsh --profile default --dump-config
```

The DSH package manifest is `plugins/ppt-svg/package.json`, and its configuration layer is `plugins/ppt-svg/cordis.patch.yml`. It registers the `svg` and `ppt` skills as a native DSH provider and bridges the bundled MCP server as `mcp__ppt_svg__render_<type>_svg` tools. After the declared `dsh-ppt-svg` package is published to npm, users can install it by package name. Add the `dsh-plugin` topic to the GitHub repository for public DSH discovery.

## Install for Hermes or OpenClaw

```bash
bash scripts/install-agent-skill.sh hermes
bash scripts/install-agent-skill.sh openclaw
```

The installer creates separate `svg` and `ppt` skill directories. It copies no API keys.

## Service selection and privacy

The bundled clients and the DSH MCP bridge default to the local service:

```bash
export PPT_SVG_BASE_URL=http://127.0.0.1:3000/ppt
```

No public Graptolite endpoint is contacted by default. Source files passed to a client are uploaded to the selected service, so only override `PPT_SVG_BASE_URL` or pass `--base-url` after the operator approves that endpoint.

The local PPT-SVG process still sends generation content to whichever LLM provider it is configured to use. For a completely private pipeline, leave `OPENROUTER_*` and `OPENAI_*` unset and configure a self-hosted OpenAI-compatible provider:

```bash
PPT_SVG_LLM_API_KEY=local-only
PPT_SVG_LLM_MODEL=your-local-model
PPT_SVG_LLM_BASE_URL=http://127.0.0.1:11434/v1
```

The service also accepts explicitly configured `OPENROUTER_*` or `OPENAI_*` providers. Keep keys in the service process; never paste them into a skill prompt. DSH's own model-provider privacy remains governed by the user's DSH profile and is separate from the PPT-SVG endpoint.

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
