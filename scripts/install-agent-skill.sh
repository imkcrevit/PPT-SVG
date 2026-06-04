#!/usr/bin/env bash
set -euo pipefail

RUNTIME="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<USAGE
Usage: scripts/install-agent-skill.sh [hermes|openclaw|local] [target-dir]

Examples:
  scripts/install-agent-skill.sh hermes
  scripts/install-agent-skill.sh openclaw
  scripts/install-agent-skill.sh local /tmp/ppt-svg-skill
USAGE
}

case "$RUNTIME" in
  hermes)
    TARGET_DIR="${2:-${HERMES_SKILLS_DIR:-$HOME/.hermes/skills/ppt-svg}}"
    ;;
  openclaw)
    TARGET_DIR="${2:-${OPENCLAW_SKILLS_DIR:-$HOME/.openclaw/skills/ppt-svg}}"
    ;;
  local)
    TARGET_DIR="${2:-}"
    if [[ -z "$TARGET_DIR" ]]; then
      usage >&2
      exit 2
    fi
    ;;
  -h|--help|help|"")
    usage
    exit 0
    ;;
  *)
    echo "Unknown runtime: $RUNTIME" >&2
    usage >&2
    exit 2
    ;;
esac

install -d "$TARGET_DIR/scripts"
install -m 0644 "$ROOT_DIR/SKILL.md" "$TARGET_DIR/SKILL.md"
install -m 0755 "$ROOT_DIR/scripts/ppt-svg-agent.mjs" "$TARGET_DIR/scripts/ppt-svg-agent.mjs"

cat <<DONE
Installed PPT-SVG skill to:
  $TARGET_DIR

Set PPT_SVG_BASE_URL if the service is not at http://127.0.0.1:3000/ppt.
For user-owned API keys, run the PPT-SVG service with OPENROUTER_*,
PPT_SVG_LLM_*, or OPENAI_* environment variables.
DONE
