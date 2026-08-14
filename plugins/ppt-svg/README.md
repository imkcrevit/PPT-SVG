# dsh-ppt-svg

DeepSeek Harness bundle for the PPT-SVG `svg` and `ppt` skills. It registers both skills through DSH's native skill catalog and exposes the bundled semantic diagram MCP tools.

## Install from GitHub

```bash
dsh plugin --profile default add github:imkcrevit/PPT-SVG#path:/plugins/ppt-svg
dsh --profile default --dump-config
```

Use `./plugins/ppt-svg` instead when installing from a local checkout.

After this package is published to npm, install it with:

```bash
dsh plugin --profile default add dsh-ppt-svg
```

## Private-by-default service

The bundle defaults to `http://127.0.0.1:3000/ppt`. Skill discovery, activation, MCP initialization, and MCP tool discovery do not call the PPT-SVG generation service. An actual generation call sends its prompt and optional attachments to the selected endpoint.

Set `PPT_SVG_BASE_URL` only when the operator explicitly approves another deployment. The local PPT-SVG service may still use an external LLM provider; configure `PPT_SVG_LLM_*` with a self-hosted OpenAI-compatible endpoint when the full generation pipeline must remain private.

The package contains plain JavaScript and needs no install-time build script.
