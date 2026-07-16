#!/usr/bin/env bash
set -euo pipefail

RUNTIME="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<USAGE
Usage: scripts/install-agent-skill.sh [hermes|openclaw|local] [skills-root]

Installs two sibling skills named svg and ppt.

Examples:
  scripts/install-agent-skill.sh hermes
  scripts/install-agent-skill.sh openclaw
  scripts/install-agent-skill.sh local /tmp/ppt-svg-skills
USAGE
}

case "$RUNTIME" in
  hermes)
    TARGET_ROOT="${2:-${HERMES_SKILLS_DIR:-${HOME:?}/.hermes/skills}}"
    ;;
  openclaw)
    TARGET_ROOT="${2:-${OPENCLAW_SKILLS_DIR:-${HOME:?}/.openclaw/skills}}"
    ;;
  local)
    TARGET_ROOT="${2:-}"
    if [[ -z "$TARGET_ROOT" ]]; then
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

install_skill() {
  local skill="$1"
  local client="$2"
  local source="$ROOT_DIR/plugins/ppt-svg/skills/$skill"
  local target="$TARGET_ROOT/$skill"

  install -d "$target/agents" "$target/references" "$target/scripts"
  install -m 0644 "$source/SKILL.md" "$target/SKILL.md"
  install -m 0644 "$source/agents/openai.yaml" "$target/agents/openai.yaml"
  install -m 0644 "$source/references/repository.md" "$target/references/repository.md"
  install -m 0755 "$source/scripts/$client" "$target/scripts/$client"
}

install_skill svg generate-svg.mjs
install_skill ppt generate-ppt.mjs

cat <<DONE
Installed the SVG and PPT skills under:
  $TARGET_ROOT/svg
  $TARGET_ROOT/ppt

The clients default to https://labs.graptolite.ai/ppt.
Set PPT_SVG_BASE_URL to use a local or another deployed service.
DONE
