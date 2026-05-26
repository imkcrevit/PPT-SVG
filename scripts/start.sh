#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"
PORT="${PORT:-3000}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/ppt}"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-ppt-svg.service}"

export NEXT_PUBLIC_BASE_PATH

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<USAGE
Usage: ./scripts/start.sh [dev|debug|prod|stop]

Environment:
  PORT=3000              Port used by Next.js.
  BIND_HOST=127.0.0.1    Hostname passed to Next.js.
  NEXT_PUBLIC_BASE_PATH=/ppt
                         Base path used by Next.js. Keep /ppt for nginx reverse proxy tests.
  NODE_INSPECT=9229      Debug inspector port for debug mode.
  SYSTEMD_SERVICE=ppt-svg.service
                         Nginx upstream app service to stop before local launches.

Examples:
  ./scripts/start.sh dev
  ./scripts/start.sh debug
  ./scripts/start.sh prod
  ./scripts/start.sh stop
USAGE
}

have() {
  command -v "$1" >/dev/null 2>&1
}

list_port_pids() {
  if have lsof; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
    printf "\n"
  fi

  if have fuser; then
    fuser -n tcp "$PORT" 2>/dev/null | tr ' ' '\n' || true
    printf "\n"
  fi

  list_proc_net_pids
  printf "\n"

  if have ss; then
    ss -ltnp "sport = :$PORT" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' || true
    printf "\n"
  fi
}

list_proc_net_pids() {
  local port_hex
  port_hex="$(printf "%04X" "$PORT")"

  mapfile -t socket_inodes < <(
    awk -v port=":$port_hex" '$2 ~ port "$" && $4 == "0A" { print $10 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null \
      | sort -u
  )

  [[ "${#socket_inodes[@]}" -eq 0 ]] && return

  for fd in /proc/[0-9]*/fd/*; do
    local target inode pid
    target="$(readlink "$fd" 2>/dev/null || true)"
    [[ "$target" =~ ^socket:\[([0-9]+)\]$ ]] || continue
    inode="${BASH_REMATCH[1]}"

    for socket_inode in "${socket_inodes[@]}"; do
      if [[ "$inode" == "$socket_inode" ]]; then
        pid="${fd#/proc/}"
        echo "${pid%%/*}"
        break
      fi
    done
  done
}

children_of() {
  local pid="$1"
  local child

  while read -r child; do
    [[ -z "$child" ]] && continue
    echo "$child"
    children_of "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
}

matching_parent_chain() {
  local pid="$1"
  local parent cmd

  while true; do
    parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [[ -z "$parent" || "$parent" == "0" || "$parent" == "1" ]] && break

    cmd="$(ps -o args= -p "$parent" 2>/dev/null || true)"
    if [[ "$cmd" =~ (^|[[:space:]/])(npm|pnpm|yarn|bun|node|next)([[:space:]]|$) ]]; then
      echo "$parent"
      pid="$parent"
    else
      break
    fi
  done
}

unique_pids() {
  awk 'NF && $1 ~ /^[0-9]+$/ && $1 != "'"$$"'" { seen[$1]=1 } END { for (pid in seen) print pid }'
}

clear_port() {
  local targets=()

  stop_related_systemd_service

  mapfile -t port_pids < <(list_port_pids | unique_pids)
  if [[ "${#port_pids[@]}" -eq 0 ]]; then
    echo "Port $PORT is clear."
    return
  fi

  mapfile -t targets < <(
    for pid in "${port_pids[@]}"; do
      echo "$pid"
      children_of "$pid"
      matching_parent_chain "$pid"
    done | unique_pids | sort -n
  )

  echo "Stopping existing service on port $PORT:"
  for pid in "${targets[@]}"; do
    ps -o pid=,ppid=,comm=,args= -p "$pid" 2>/dev/null || true
  done

  kill -TERM "${targets[@]}" 2>/dev/null || true
  sleep 2

  if list_port_pids | unique_pids | grep -q .; then
    echo "Port $PORT is still occupied; forcing remaining listener shutdown."
    kill -KILL "${targets[@]}" 2>/dev/null || true
    sleep 1
  fi

  if list_port_pids | unique_pids | grep -q .; then
    echo "Port $PORT is still occupied. Inspect manually before starting." >&2
    exit 1
  fi

  echo "Port $PORT is clear."
}

check_prod_build_config() {
  local expected_base_path="${NEXT_PUBLIC_BASE_PATH:-}"
  local required_files=".next/required-server-files.json"

  [[ -z "$expected_base_path" || ! -f "$required_files" ]] && return

  local built_base_path
  built_base_path="$(node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('$required_files','utf8')); process.stdout.write(j.config.basePath || '')")"

  if [[ "$built_base_path" != "$expected_base_path" ]]; then
    echo "Build basePath mismatch: built '$built_base_path', runtime expects '$expected_base_path'." >&2
    echo "Run: NEXT_PUBLIC_BASE_PATH=$expected_base_path npm run build" >&2
    exit 1
  fi
}

stop_related_systemd_service() {
  [[ "${SKIP_SYSTEMD_STOP:-0}" == "1" ]] && return
  [[ -n "${INVOCATION_ID:-}" ]] && return
  have systemctl || return

  if systemctl is-active --quiet "$SYSTEMD_SERVICE" 2>/dev/null; then
    echo "Stopping nginx upstream app service: $SYSTEMD_SERVICE"
    systemctl stop "$SYSTEMD_SERVICE" 2>/dev/null || true
    sleep 2
  fi
}

case "$MODE" in
  dev)
    clear_port
    exec ./node_modules/.bin/next dev --hostname "$BIND_HOST" --port "$PORT"
    ;;
  debug)
    clear_port
    exec node --inspect="${NODE_INSPECT:-9229}" ./node_modules/next/dist/bin/next dev --hostname "$BIND_HOST" --port "$PORT"
    ;;
  prod|start)
    clear_port
    check_prod_build_config
    exec ./node_modules/.bin/next start --hostname "$BIND_HOST" --port "$PORT"
    ;;
  stop)
    clear_port
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac
