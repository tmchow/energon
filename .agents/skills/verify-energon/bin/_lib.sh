#!/usr/bin/env bash
# Shared paths and helpers for verify-energon. Sourced by the other bin scripts.

set -euo pipefail

VERIFY_ROOT="${ENERGON_VERIFY_ROOT:-/tmp/energon-verify}"
EVIDENCE_ROOT="${ENERGON_VERIFY_EVIDENCE_ROOT:-/tmp/energon-verify-evidence}"
DEFAULT_PORT="${ENERGON_VERIFY_PORT:-18787}"

_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$_script_dir/../../../.." && pwd)"
CURRENT_FILE="$VERIFY_ROOT/current"

die() {
  printf 'verify-energon: %s\n' "$*" >&2
  exit 1
}

run_id() {
  if [[ -n "${ENERGON_VERIFY_RUN:-}" ]]; then
    printf '%s\n' "$ENERGON_VERIFY_RUN"
    return
  fi
  if [[ -f "$CURRENT_FILE" ]]; then
    cat "$CURRENT_FILE"
    return
  fi
  die "no active run. Set ENERGON_VERIFY_RUN or run bin/launch first."
}

state_dir() {
  printf '%s/%s\n' "$VERIFY_ROOT" "$(run_id)"
}

state_file() {
  printf '%s/state.env\n' "$(state_dir)"
}

load_state() {
  local f
  f="$(state_file)"
  [[ -f "$f" ]] || die "missing state file $f"
  # shellcheck disable=SC1090
  set -a
  source "$f"
  set +a
  [[ -n "${ORIGIN:-}" && -n "${PORT:-}" && -n "${PID:-}" ]] || die "state file $f is incomplete"
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

listen_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
    return
  fi
  ss -ltnp "sport = :$port" 2>/dev/null \
    | grep -oE 'pid=[0-9]+' \
    | cut -d= -f2 \
    | sort -u || true
}

port_in_use() {
  local port="$1"
  local pids
  pids="$(listen_pids "$port")"
  [[ -n "$pids" ]]
}

json_get() {
  local json="$1" key="$2"
  python3 - "$json" "$key" <<'PY'
import json, sys
raw, key = sys.argv[1], sys.argv[2]
data = json.loads(raw)
cur = data
for part in key.split("."):
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        sys.exit(1)
if cur is None:
    print("")
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

curl_status() {
  local method="$1" url="$2"
  shift 2
  curl -sS -o /tmp/energon-verify-body.$$ -w '%{http_code}' -X "$method" "$url" "$@"
}

curl_body() {
  cat /tmp/energon-verify-body.$$
}
