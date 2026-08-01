#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
aurora_assert_root

case "$#" in
  0) ;;
  1) case "$1" in -h|--help) printf '%s\n' "Usage: scripts/stop.sh"; exit 0 ;; *) aurora_die "Okänt argument: $1 / Unknown argument: $1" ;; esac ;;
  *) aurora_die "stop tar inga argument. / stop takes no arguments." ;;
esac

aurora_assert_mutable_layout
logs="$AURORA_ROOT/data/logs"
stopped=0
for name in supervisor app llama; do
  pid=$(aurora_read_pid "$logs/$name.pid" 2>/dev/null || true)
  [ -n "$pid" ] || continue
  if aurora_pid_alive "$pid"; then
    if aurora_pid_owned "$pid"; then
      kill "$pid" 2>/dev/null || true
      stopped=1
    else
      aurora_warn "Ignorerar inaktuell PID $pid ($name). / Ignoring stale PID $pid ($name)."
    fi
  fi
done

supervisor_pid=$(aurora_read_pid "$logs/supervisor.pid" 2>/dev/null || true)
if [ -n "$supervisor_pid" ]; then
  wait_count=0
  while aurora_pid_alive "$supervisor_pid" && [ "$wait_count" -lt 50 ]; do
    sleep 0.2
    wait_count=$((wait_count + 1))
  done
fi
rm -f -- "$logs/supervisor.pid" "$logs/app.pid" "$logs/llama.pid" 2>/dev/null || true
if [ "$stopped" -eq 1 ]; then
  aurora_info "Aurora har stoppats. Data är orörda. / Aurora has stopped. Data is untouched."
else
  aurora_info "Aurora kördes inte. / Aurora was not running."
fi
