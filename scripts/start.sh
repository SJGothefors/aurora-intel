#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
aurora_assert_root

bootstrap_file=''
cleanup_bootstrap() {
  if [ -n "$bootstrap_file" ]; then
    rm -f -- "$bootstrap_file" 2>/dev/null || true
    bootstrap_file=''
  fi
}
trap cleanup_bootstrap EXIT
trap 'exit 130' HUP INT TERM

app_override=''
llm_override=''
open_browser=1
allow_unverified_model=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --port) [ "$#" -ge 2 ] || aurora_die "--port kräver ett värde. / --port requires a value."; app_override=$2; shift 2 ;;
    --llm-port) [ "$#" -ge 2 ] || aurora_die "--llm-port kräver ett värde. / --llm-port requires a value."; llm_override=$2; shift 2 ;;
    --no-open) open_browser=0; shift ;;
    --allow-unverified-model) allow_unverified_model=1; shift ;;
    -h|--help) printf '%s\n' "Usage: scripts/start.sh [--port PORT] [--llm-port PORT] [--no-open] [--allow-unverified-model]"; exit 0 ;;
    *) aurora_die "Okänt argument: $1 / Unknown argument: $1" ;;
  esac
done

node_bin=$(aurora_node_bin)
[ -x "$node_bin" ] || aurora_die "Aurora är inte byggt. Kör build.command eller build.sh först. / Aurora is not built. Run build.command or build.sh first."
[ -f "$AURORA_ROOT/.runtime/install.json" ] || aurora_die "Byggmarkör saknas. Kör build igen. / Build marker is missing. Run build again."
[ -f "$AURORA_ROOT/server/index.mjs" ] || aurora_die "Serverfil saknas. / Server entrypoint is missing."
[ -d "$AURORA_ROOT/web/dist" ] || aurora_die "Webbbygge saknas. / Web build is missing."
aurora_prepare_mutable_layout
aurora_assert_local_config_safe

open_authenticated_session() {
  aurora_clean_url=$1
  aurora_bootstrap_candidate="$AURORA_ROOT/data/logs/.aurora-session-$$.html"
  "$node_bin" "$AURORA_ROOT/scripts/session-bootstrap.mjs" "$aurora_clean_url" "$aurora_bootstrap_candidate" || aurora_die "Kunde inte skapa säker webbläsarsession. Stoppa och starta Aurora igen. / Could not create a safe browser session. Stop and restart Aurora."
  bootstrap_file=$aurora_bootstrap_candidate
  aurora_open_local_file "$bootstrap_file"
  # The browser launcher returns before a cold browser necessarily reads the
  # local file. Keep it briefly, then remove the only on-disk bootstrap copy.
  sleep 10
  cleanup_bootstrap
}

supervisor_pid=$(aurora_read_pid "$AURORA_ROOT/data/logs/supervisor.pid" 2>/dev/null || true)
if [ -n "$supervisor_pid" ] && aurora_pid_owned "$supervisor_pid" "$AURORA_ROOT/scripts/supervisor.mjs"; then
  state_url=$("$node_bin" -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(s.url)process.stdout.write(s.url)}catch{}' "$AURORA_ROOT/data/logs/state.json")
  state_url=$(aurora_safe_loopback_url "$state_url" 2>/dev/null || true)
  if [ -z "$state_url" ]; then
    aurora_warn "Ogiltig state-URL ignorerades. / Invalid state URL was ignored."
    state_url="http://127.0.0.1:$(aurora_config_get appPort)"
  fi
  aurora_info "Aurora körs redan: $state_url / Aurora is already running: $state_url"
  [ "$open_browser" -eq 0 ] || open_authenticated_session "$state_url"
  exit 0
elif [ -n "$supervisor_pid" ] && aurora_pid_alive "$supervisor_pid"; then
  aurora_warn "PID-filen pekar inte på Auroras supervisor och ignoreras. / PID file does not point to Aurora's supervisor and was ignored."
fi

requested_app=${app_override:-$(aurora_config_get appPort)}
requested_llm=${llm_override:-$(aurora_config_get llmPort)}
case "$requested_app:$requested_llm" in *[!0-9:]*|:*|*:) aurora_die "Portar måste vara heltal. / Ports must be integers." ;; esac
[ "$requested_app" -ge 1 ] && [ "$requested_app" -le 65535 ] || aurora_die "Ogiltig app-port. / Invalid app port."
[ "$requested_llm" -ge 1 ] && [ "$requested_llm" -le 65535 ] || aurora_die "Ogiltig LLM-port. / Invalid LLM port."
app_port=$("$node_bin" "$AURORA_ROOT/scripts/port-utils.mjs" "$requested_app")
llm_port=$("$node_bin" "$AURORA_ROOT/scripts/port-utils.mjs" "$requested_llm" "$app_port")
[ "$app_port" = "$requested_app" ] || aurora_warn "Port $requested_app var upptagen; använder $app_port. / Port $requested_app was busy; using $app_port."
[ "$llm_port" = "$requested_llm" ] || aurora_warn "LLM-port $requested_llm var upptagen; använder $llm_port. / LLM port $requested_llm was busy; using $llm_port."

llama_bin=$(aurora_find_llama)
[ -n "$llama_bin" ] || aurora_die "llama-server saknas i .runtime. Kör build igen. / llama-server is missing from .runtime. Run build again."
model_rel=$(aurora_config_get modelPath)
model=$("$node_bin" "$AURORA_ROOT/scripts/config-cli.mjs" model)
[ -f "$model" ] && [ ! -L "$model" ] || aurora_die "Vald GGUF-modell saknas eller är en symbolisk länk: $model_rel / Selected GGUF model is missing or is a symbolic link: $model_rel"
case "$model" in "$AURORA_ROOT"/llm/models/*) model_manifest_rel=${model#"$AURORA_ROOT"/} ;; *) aurora_die "Vald modell ligger utanför llm/models. / Selected model is outside llm/models." ;; esac
if aurora_manifest_has_path "$model_manifest_rel" && aurora_is_locked_model_path "$model_manifest_rel"; then
  :
elif [ "$allow_unverified_model" -eq 1 ]; then
  aurora_warn "OVERIFIERAD MODELL TILLÅTS UTTRYCKLIGEN: $model_manifest_rel / UNVERIFIED MODEL EXPLICITLY ALLOWED."
  aurora_warn "GGUF är native-parserindata. Kör endast i organisationens godkända OS-sandbox och verifiera proveniens. / GGUF is native-parser input. Use an approved OS sandbox and verify provenance."
else
  aurora_die "Vald modell är inte en manifestverifierad kind=model-artefakt: $model_manifest_rel. Välj den pinnade modellen eller starta uttryckligen med --allow-unverified-model i en godkänd sandbox. / Selected model is not a manifest-verified kind=model artifact. Select the pinned model or explicitly use --allow-unverified-model in an approved sandbox."
fi
for log_name in supervisor app llama server; do
  aurora_prepare_log_file "$AURORA_ROOT/data/logs/$log_name.log"
done
rm -f -- "$AURORA_ROOT/data/logs/supervisor.pid" "$AURORA_ROOT/data/logs/app.pid" "$AURORA_ROOT/data/logs/llama.pid"

nohup "$node_bin" "$AURORA_ROOT/scripts/supervisor.mjs" \
  --root "$AURORA_ROOT" \
  --node "$node_bin" \
  --server "$AURORA_ROOT/server/index.mjs" \
  --llama "$llama_bin" \
  --model "$model" \
  --app-port "$app_port" \
  --llm-port "$llm_port" \
  --data-dir "$AURORA_ROOT/data" \
  --context-size "$(aurora_config_get llm.contextSize)" \
  --seed "$(aurora_config_get llm.seed)" \
  >/dev/null 2>&1 &
launcher_pid=$!
url="http://127.0.0.1:$app_port"
if ! "$node_bin" "$AURORA_ROOT/scripts/wait-for-http.mjs" "$url/api/health" 90000; then
  kill "$launcher_pid" 2>/dev/null || true
  aurora_die "Appservern startade inte. Se data/logs/app.log och data/logs/supervisor.log. / App server did not start. See data/logs/app.log and data/logs/supervisor.log."
fi
aurora_info "Aurora Intel: $url"
aurora_info "Endast denna dator kan ansluta (127.0.0.1). / Only this computer can connect (127.0.0.1)."
[ "$open_browser" -eq 0 ] || open_authenticated_session "$url"
