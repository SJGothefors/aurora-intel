#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
aurora_assert_root

restore_latest=0
for aurora_arg in "$@"; do
  case "$aurora_arg" in
    --restore-latest) restore_latest=1 ;;
    -h|--help)
      printf '%s\n' "Usage: scripts/build.sh [--restore-latest]"
      exit 0
      ;;
    *) aurora_die "Okänt argument: $aurora_arg / Unknown argument: $aurora_arg" ;;
  esac
done

aurora_verify_checksums
aurora_assert_mutable_layout
aurora_assert_local_config_safe
if [ -f "$AURORA_ROOT/config/app.local.json" ]; then
  aurora_warn "Lokal konfiguration ignoreras under build; verifierade standardvärden används. / Local configuration is ignored during build; verified defaults are used."
fi
export AURORA_CONFIG_DEFAULTS_ONLY=1
platform=$(aurora_platform)
case "$platform" in
  macos-arm64|macos-x64)
    node_archive="$AURORA_ROOT/runtime/payload/node-$platform.tar.gz"
    llama_archive="$AURORA_ROOT/llm/payload/llama-$platform.tar.gz"
    ;;
  *) aurora_die "Använd build.bat på Windows. / Use build.bat on Windows." ;;
esac
[ -f "$node_archive" ] || aurora_die "Portabel Node-runtime saknas: runtime/payload/node-$platform.tar.gz. Kör prepare_release online. / Portable Node runtime is missing. Run prepare_release online."
[ -f "$llama_archive" ] || aurora_die "llama-server saknas för $platform. Kör prepare_release online. / llama-server is missing for $platform. Run prepare_release online."
[ -d "$AURORA_ROOT/offline/npm-cache/_cacache" ] || aurora_die "Offline npm-lager saknas. Kör prepare_release online. / Offline npm store is missing. Run prepare_release online."
[ -f "$AURORA_ROOT/package-lock.json" ] || aurora_die "package-lock.json saknas. / package-lock.json is missing."
[ -d "$AURORA_ROOT/web/dist" ] || aurora_die "Byggd webbklient saknas. Kör prepare_release online. / Built web client is missing. Run prepare_release online."

for stale_runtime in "$AURORA_ROOT"/.runtime.build.* "$AURORA_ROOT"/.runtime.previous.*; do
  if [ -e "$stale_runtime" ] || [ -L "$stale_runtime" ]; then
    aurora_die "Oväntat runtime-stagingobjekt finns: $(basename "$stale_runtime"). Flytta det åt sidan och kör build igen. / Unexpected runtime staging state exists. Move it aside and run build again."
  fi
done
if [ -L "$AURORA_ROOT/.runtime" ]; then
  aurora_die ".runtime får inte vara en symbolisk länk. Ta bort länken manuellt efter granskning. / .runtime must not be a symbolic link. Remove it manually after review."
fi

# The installed runtime is mutable and intentionally absent from the release
# manifest. Never execute or reuse it during build: stop owned processes,
# remove it, and install a fresh candidate extracted from verified archives.
"$AURORA_ROOT/scripts/stop.sh"
rm -rf -- "$AURORA_ROOT/.runtime"
runtime_candidate=$(mktemp -d "$AURORA_ROOT/.runtime.build.XXXXXX")
self_pid=''
cleanup_build() {
  if [ -n "$self_pid" ]; then
    kill "$self_pid" 2>/dev/null || true
    wait "$self_pid" 2>/dev/null || true
    self_pid=''
  fi
  if [ -n "${runtime_candidate:-}" ] && { [ -e "$runtime_candidate" ] || [ -L "$runtime_candidate" ]; }; then
    rm -rf -- "$runtime_candidate" 2>/dev/null || true
  fi
}
trap cleanup_build EXIT
trap 'exit 130' HUP INT TERM

node_dir="$runtime_candidate/node"
llama_dir="$runtime_candidate/llama"
mkdir "$node_dir" "$llama_dir"
tar -xzf "$node_archive" --strip-components=1 -C "$node_dir"
[ -x "$node_dir/bin/node" ] || aurora_die "Node-arkivet har oväntat innehåll. / Node archive has unexpected contents."
tar -xzf "$llama_archive" -C "$llama_dir"
llama_bin=$(aurora_find_llama "$llama_dir")
[ -n "$llama_bin" ] || aurora_die "llama-server hittades inte i det verifierade arkivet. / llama-server was not found in the verified archive."
chmod +x "$llama_bin"

node_bin="$node_dir/bin/node"
npm_cli="$node_dir/lib/node_modules/npm/bin/npm-cli.js"
[ -f "$npm_cli" ] || aurora_die "npm saknas i den portabla Node-runtimen. / npm is missing from the portable Node runtime."
aurora_info "Installerar produktionsberoenden från offline-lagret ... / Installing production dependencies from the offline store ..."
(
  cd "$AURORA_ROOT"
  npm_config_update_notifier=false npm_config_audit=false npm_config_cache="$AURORA_ROOT/offline/npm-cache" "$node_bin" "$npm_cli" ci --offline --cache "$AURORA_ROOT/offline/npm-cache" --omit=dev --ignore-scripts --no-audit --no-fund
)

aurora_prepare_mutable_layout
aurora_info "Initierar databas och BAS-begreppslista ... / Initializing database and BAS vocabulary ..."
"$node_bin" "$AURORA_ROOT/server/index.mjs" --root "$AURORA_ROOT" --data-dir "$AURORA_ROOT/data" --migrate-only

if [ "$restore_latest" -eq 1 ]; then
  latest_export=$(find "$AURORA_ROOT/exports" -maxdepth 1 -type f \( -name 'aurora-final-*.xlsx' -o -name 'aurora-final-*.csv' \) -print 2>/dev/null | sort | tail -n 1)
  [ -n "$latest_export" ] || aurora_die "Ingen tidigare export hittades. / No previous export was found."
  aurora_info "Återställer: $(basename "$latest_export") / Restoring: $(basename "$latest_export")"
  "$node_bin" "$AURORA_ROOT/server/index.mjs" --root "$AURORA_ROOT" --data-dir "$AURORA_ROOT/data" --import "$latest_export"
fi

"$node_bin" "$AURORA_ROOT/scripts/local-self-test.mjs"
llm_port=$("$node_bin" "$AURORA_ROOT/scripts/port-utils.mjs" "$(aurora_config_get llmPort "$node_bin")")
model_rel=$(aurora_config_get modelPath "$node_bin")
model=$("$node_bin" "$AURORA_ROOT/scripts/config-cli.mjs" model)
[ -f "$model" ] || aurora_die "GGUF-modellen saknas: $model_rel. Modellen är flera GB och måste hämtas av prepare_release innan USB-kopiering. / GGUF model is missing. The multi-GB model must be fetched by prepare_release before USB transfer."
case "$model" in "$AURORA_ROOT"/llm/models/*) model_manifest_rel=${model#"$AURORA_ROOT"/} ;; *) aurora_die "Standardmodellen ligger utanför llm/models. / Default model is outside llm/models." ;; esac
aurora_manifest_has_path "$model_manifest_rel" || aurora_die "Standardmodellen är inte manifestverifierad: $model_manifest_rel / Default model is not manifest-verified."
aurora_is_locked_model_path "$model_manifest_rel" || aurora_die "Standardmodellen är inte en pinnad kind=model-artefakt: $model_manifest_rel / Default model is not a pinned kind=model artifact."
self_log="$AURORA_ROOT/data/logs/build-self-test.log"
aurora_prepare_log_file "$self_log"
api_key=$("$node_bin" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
[ ${#api_key} -eq 64 ] || aurora_die "Kunde inte skapa lokal LLM-nyckel. / Could not generate the local LLM key."
aurora_info "Startar lokalt LLM-självtest (det kan ta några minuter) ... / Starting local LLM self-test (this can take a few minutes) ..."
LLAMA_API_KEY="$api_key" "$llama_bin" --host 127.0.0.1 --port "$llm_port" --model "$model" --ctx-size "$(aurora_config_get llm.contextSize "$node_bin")" --seed "$(aurora_config_get llm.seed "$node_bin")" --n-gpu-layers 99 >"$self_log" 2>&1 &
self_pid=$!
cleanup_self_test() {
  if [ -n "$self_pid" ]; then
    kill "$self_pid" 2>/dev/null || true
    wait "$self_pid" 2>/dev/null || true
    self_pid=''
  fi
}
"$node_bin" "$AURORA_ROOT/scripts/wait-for-http.mjs" "http://127.0.0.1:$llm_port/health" 240000 || aurora_die "llama-server startade inte. Se data/logs/build-self-test.log. / llama-server did not start. See data/logs/build-self-test.log."
AURORA_LLM_API_KEY="$api_key" "$node_bin" "$AURORA_ROOT/scripts/llm-self-test.mjs" "$llm_port" || aurora_die "Det grammatikstyrda LLM-testet misslyckades. Se data/logs/build-self-test.log. / Grammar-constrained LLM test failed. See data/logs/build-self-test.log."
AURORA_LLM_API_KEY="$api_key" "$node_bin" "$AURORA_ROOT/server/index.mjs" --root "$AURORA_ROOT" --data-dir "$AURORA_ROOT/data" --llm-port "$llm_port" --self-test
cleanup_self_test
unset api_key

node_hash=$(aurora_sha256 "$node_archive")
llama_hash=$(aurora_sha256 "$llama_archive")
printf '{"platform":"%s","nodeArchiveSha256":"%s","llamaArchiveSha256":"%s","builtAt":"%s"}\n' "$platform" "$node_hash" "$llama_hash" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$runtime_candidate/install.json"
"$node_bin" -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$runtime_candidate" "$AURORA_ROOT/.runtime"
runtime_candidate=''
trap - EXIT HUP INT TERM
aurora_info "OK — Aurora Intel är byggt offline. Kör start.command eller start.sh. / Aurora Intel is built offline. Run start.command or start.sh."
