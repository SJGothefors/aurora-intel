#!/bin/sh

# Shared POSIX helpers. This file is sourced; callers enable their own strict mode.
AURORA_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$AURORA_SCRIPT_DIR" in
  */scripts) AURORA_ROOT=$(CDPATH= cd -- "$AURORA_SCRIPT_DIR/.." && pwd) ;;
  */scripts/lib) AURORA_ROOT=$(CDPATH= cd -- "$AURORA_SCRIPT_DIR/../.." && pwd) ;;
  *) AURORA_ROOT=$(CDPATH= cd -- "$AURORA_SCRIPT_DIR" && pwd) ;;
esac

aurora_info() { printf '%s\n' "$*"; }
aurora_warn() { printf 'VARNING / WARNING: %s\n' "$*" >&2; }
aurora_die() { printf 'FEL / ERROR: %s\n' "$*" >&2; exit 1; }

aurora_assert_root() {
  [ -f "$AURORA_ROOT/config/app.defaults.json" ] || aurora_die "Ogiltig Aurora-mapp. / Invalid Aurora folder: $AURORA_ROOT"
  [ -f "$AURORA_ROOT/scripts/lib/common.sh" ] || aurora_die "Livscykelskript saknas. / Lifecycle scripts are missing."
}

aurora_platform() {
  aurora_os=$(uname -s 2>/dev/null || printf unknown)
  aurora_arch=$(uname -m 2>/dev/null || printf unknown)
  case "$aurora_os:$aurora_arch" in
    Darwin:arm64|Darwin:aarch64) printf 'macos-arm64\n' ;;
    Darwin:x86_64) printf 'macos-x64\n' ;;
    MINGW*:x86_64|MSYS*:x86_64|CYGWIN*:x86_64) printf 'windows-x64\n' ;;
    *) aurora_die "Plattformen stöds inte: $aurora_os/$aurora_arch. / Unsupported platform: $aurora_os/$aurora_arch." ;;
  esac
}

aurora_sha256() {
  aurora_hash_file=$1
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$aurora_hash_file" | awk '{print tolower($1)}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$aurora_hash_file" | awk '{print tolower($1)}'
  else
    aurora_die "SHA-256-verktyg saknas. / No SHA-256 tool is available."
  fi
}

aurora_file_link_count() {
  aurora_link_file=$1
  if stat -f '%l' "$aurora_link_file" >/dev/null 2>&1; then
    stat -f '%l' "$aurora_link_file"
  elif stat -c '%h' "$aurora_link_file" >/dev/null 2>&1; then
    stat -c '%h' "$aurora_link_file"
  else
    aurora_die "Kan inte kontrollera hårdlänkar: $aurora_link_file / Cannot inspect hard links."
  fi
}

aurora_manifest_has_path() {
  aurora_manifest_lookup=$1
  LC_ALL=C awk -v wanted="$aurora_manifest_lookup" '
    length($0) >= 67 && substr($0, 67) == wanted { found=1 }
    END { exit(found ? 0 : 1) }
  ' "$AURORA_ROOT/checksums.txt"
}

aurora_is_locked_model_path() {
  aurora_model_lookup=$1
  while IFS='|' read -r aurora_model_id aurora_model_platform aurora_model_kind aurora_model_filename aurora_model_url aurora_model_sha aurora_model_destination || [ -n "${aurora_model_id:-}" ]; do
    case "${aurora_model_id:-}" in ''|'#'*) continue ;; esac
    if [ "$aurora_model_kind" = "model" ] && [ "$aurora_model_destination" = "$aurora_model_lookup" ]; then return 0; fi
  done < "$AURORA_ROOT/config/versions.lock"
  return 1
}

aurora_verify_checksums() {
  aurora_manifest="$AURORA_ROOT/checksums.txt"
  [ -f "$aurora_manifest" ] && [ ! -L "$aurora_manifest" ] || aurora_die "checksums.txt saknas eller är en länk. Detta är inte ett komplett offlinepaket. / checksums.txt is missing or is a link. This is not a complete offline package."
  aurora_info "Verifierar offlinepaketet ... / Verifying offline package ..."
  aurora_manifest_count=0
  aurora_manifest_paths=''
  while IFS= read -r aurora_line || [ -n "$aurora_line" ]; do
    [ -n "$aurora_line" ] || aurora_die "Tom rad i checksums.txt. / Empty checksums.txt entry."
    aurora_expected=${aurora_line%%  *}
    aurora_rel=${aurora_line#*  }
    [ "$aurora_line" != "$aurora_rel" ] && [ "$aurora_line" = "$aurora_expected  $aurora_rel" ] || aurora_die "Ogiltig rad i checksums.txt. / Invalid checksums.txt entry."
    case "$aurora_expected" in *[!0-9a-fA-F]*|'') aurora_die "Ogiltig kontrollsumma i checksums.txt. / Invalid checksum entry." ;; esac
    [ ${#aurora_expected} -eq 64 ] || aurora_die "Ogiltig kontrollsumma i checksums.txt. / Invalid checksum entry."
    case "$aurora_rel" in
      ''|/*|../*|*/../*|*/..|*//*|./*|*\\*|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/@+-]*)
        aurora_die "Osäker sökväg i checksums.txt: $aurora_rel / Unsafe path in checksums.txt."
        ;;
      checksums.txt|config/app.local.json|.runtime/*|.cache/*|.git/*|data/*|exports/*|node_modules/*|release/*)
        aurora_die "Föränderlig sökväg får inte finnas i checksums.txt: $aurora_rel / Mutable path must not be in checksums.txt."
        ;;
    esac
    case "
$aurora_manifest_paths
" in *"
$aurora_rel
"*) aurora_die "Duplicerad sökväg i checksums.txt: $aurora_rel / Duplicate checksum path." ;; esac
    aurora_manifest_paths=${aurora_manifest_paths}${aurora_manifest_paths:+"
"}$aurora_rel
    aurora_manifest_count=$((aurora_manifest_count + 1))
    aurora_abs="$AURORA_ROOT/$aurora_rel"
    [ -f "$aurora_abs" ] && [ ! -L "$aurora_abs" ] || aurora_die "Fil saknas eller är en länk: $aurora_rel / File is missing or is a link: $aurora_rel"
    [ "$(aurora_file_link_count "$aurora_abs")" -eq 1 ] || aurora_die "Hårdlänk är inte tillåten i releaseinnehåll: $aurora_rel / Hard-linked release file is not allowed."
    aurora_actual=$(aurora_sha256 "$aurora_abs")
    [ "$aurora_actual" = "$(printf '%s' "$aurora_expected" | tr 'A-F' 'a-f')" ] || aurora_die "Kontrollsumman stämmer inte: $aurora_rel / Checksum mismatch: $aurora_rel"
  done < "$aurora_manifest"
  [ "$aurora_manifest_count" -gt 0 ] || aurora_die "checksums.txt är tom. / checksums.txt is empty."

  for aurora_required in \
    build.sh scripts/build.sh scripts/lib/common.sh scripts/config-cli.mjs \
    config/app.defaults.json config/versions.lock package.json package-lock.json \
    server/index.mjs web/dist/index.html; do
    aurora_manifest_has_path "$aurora_required" || aurora_die "Obligatorisk manifestpost saknas: $aurora_required / Required manifest entry is missing."
  done
  aurora_has_npm_cache=0
  while IFS='|' read -r aurora_lock_id aurora_lock_platform aurora_lock_kind aurora_lock_filename aurora_lock_url aurora_lock_sha aurora_lock_destination || [ -n "${aurora_lock_id:-}" ]; do
    case "${aurora_lock_id:-}" in ''|'#'*) continue ;; esac
    [ -n "$aurora_lock_destination" ] || aurora_die "Ogiltig config/versions.lock. / Invalid config/versions.lock."
    aurora_manifest_has_path "$aurora_lock_destination" || aurora_die "Pinnad artefakt saknas i manifestet: $aurora_lock_destination / Pinned artifact is missing from the manifest."
  done < "$AURORA_ROOT/config/versions.lock"
  case "
$aurora_manifest_paths
" in *"
offline/npm-cache/"*) aurora_has_npm_cache=1 ;; esac
  [ "$aurora_has_npm_cache" -eq 1 ] || aurora_die "Offline npm-lagret saknas i manifestet. / Offline npm store is missing from the manifest."

  aurora_actual_list=$(mktemp /tmp/aurora-manifest-files.XXXXXX) || aurora_die "Kunde inte skapa temporär verifieringsfil. / Could not create verification file."
  find "$AURORA_ROOT" -mindepth 1 \
    \( -path "$AURORA_ROOT/.runtime" -o -path "$AURORA_ROOT/.cache" -o -path "$AURORA_ROOT/.git" -o -path "$AURORA_ROOT/data" -o -path "$AURORA_ROOT/exports" -o -path "$AURORA_ROOT/node_modules" -o -path "$AURORA_ROOT/release" \) -prune -o \
    \( -path "$AURORA_ROOT/config/app.local.json" -o -path "$AURORA_ROOT/checksums.txt" \) -prune -o \
    ! -type d -print > "$aurora_actual_list"
  while IFS= read -r aurora_abs || [ -n "$aurora_abs" ]; do
    aurora_rel=${aurora_abs#"$AURORA_ROOT"/}
    [ -f "$aurora_abs" ] && [ ! -L "$aurora_abs" ] || { rm -f -- "$aurora_actual_list"; aurora_die "Otillåten länk eller specialfil i releaseinnehåll: $aurora_rel / Link or special file is not allowed in release content."; }
    aurora_manifest_has_path "$aurora_rel" || { rm -f -- "$aurora_actual_list"; aurora_die "Oväntad fil utanför manifestet: $aurora_rel / Unexpected file outside the manifest."; }
  done < "$aurora_actual_list"
  rm -f -- "$aurora_actual_list"
}

aurora_assert_real_directory_if_present() {
  aurora_directory=$1
  if [ -L "$aurora_directory" ] || { [ -e "$aurora_directory" ] && [ ! -d "$aurora_directory" ]; }; then
    aurora_die "Osäker katalogsökväg: $aurora_directory / Unsafe directory path."
  fi
}

aurora_assert_mutable_layout() {
  for aurora_mutable in \
    "$AURORA_ROOT/data" "$AURORA_ROOT/data/mirror" "$AURORA_ROOT/data/backups" "$AURORA_ROOT/data/logs" \
    "$AURORA_ROOT/exports" "$AURORA_ROOT/node_modules"; do
    aurora_assert_real_directory_if_present "$aurora_mutable"
  done
}

aurora_prepare_mutable_layout() {
  aurora_assert_mutable_layout
  umask 077
  for aurora_mutable in "$AURORA_ROOT/data" "$AURORA_ROOT/data/mirror" "$AURORA_ROOT/data/backups" "$AURORA_ROOT/data/logs" "$AURORA_ROOT/exports"; do
    if [ ! -d "$aurora_mutable" ]; then
      mkdir "$aurora_mutable" || aurora_die "Kunde inte skapa säker datakatalog: $aurora_mutable / Could not create safe data directory."
    fi
    aurora_assert_real_directory_if_present "$aurora_mutable"
  done
  chmod 700 "$AURORA_ROOT/data" "$AURORA_ROOT/data/mirror" "$AURORA_ROOT/data/backups" "$AURORA_ROOT/data/logs" "$AURORA_ROOT/exports" 2>/dev/null || true
}

aurora_prepare_log_file() {
  aurora_log_file=$1
  aurora_assert_real_directory_if_present "$(dirname "$aurora_log_file")"
  if [ -L "$aurora_log_file" ] || { [ -e "$aurora_log_file" ] && [ ! -f "$aurora_log_file" ]; }; then
    aurora_die "Osäker loggfil: $aurora_log_file / Unsafe log file."
  fi
  if [ -f "$aurora_log_file" ]; then
    [ "$(aurora_file_link_count "$aurora_log_file")" -eq 1 ] || aurora_die "Hårdlänkad loggfil avvisades: $aurora_log_file / Hard-linked log file was rejected."
  else
    (umask 077; set -C; : > "$aurora_log_file") 2>/dev/null || aurora_die "Kunde inte skapa säker loggfil: $aurora_log_file / Could not create safe log file."
  fi
  chmod 600 "$aurora_log_file" 2>/dev/null || true
}

aurora_assert_local_config_safe() {
  aurora_local="$AURORA_ROOT/config/app.local.json"
  if [ -L "$aurora_local" ] || { [ -e "$aurora_local" ] && [ ! -f "$aurora_local" ]; }; then
    aurora_die "config/app.local.json måste vara en vanlig fil, inte en länk. / config/app.local.json must be a regular file, not a link."
  fi
  if [ -f "$aurora_local" ]; then
    [ "$(aurora_file_link_count "$aurora_local")" -eq 1 ] || aurora_die "Hårdlänkad lokal konfiguration avvisades. / Hard-linked local configuration was rejected."
  fi
}

aurora_preflight_archive() {
  aurora_archive=$1
  aurora_archive_kind=$2
  [ -f "$aurora_archive" ] && [ ! -L "$aurora_archive" ] || aurora_die "Arkivet saknas eller är en länk: $aurora_archive / Archive is missing or is a link."
  aurora_archive_names=$(mktemp /tmp/aurora-archive-names.XXXXXX) || aurora_die "Kunde inte skapa temporär arkivlista. / Could not create archive inventory."
  aurora_archive_verbose=$(mktemp /tmp/aurora-archive-types.XXXXXX) || { rm -f -- "$aurora_archive_names"; aurora_die "Kunde inte skapa temporär arkivlista. / Could not create archive inventory."; }
  if ! tar -tf "$aurora_archive" > "$aurora_archive_names" 2>/dev/null || ! tar -tvf "$aurora_archive" > "$aurora_archive_verbose" 2>/dev/null; then
    rm -f -- "$aurora_archive_names" "$aurora_archive_verbose"
    aurora_die "Arkivlistan kunde inte läsas: $(basename "$aurora_archive") / Archive inventory could not be read."
  fi
  if ! LC_ALL=C awk -v kind="$aurora_archive_kind" '
    BEGIN { count=0; root="" }
    {
      name=$0
      if (name == "" || name !~ /^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._+\/@-]+$/ || name ~ /^\// || name ~ /\/\// || name ~ /\\/ || name ~ /:/) exit 10
      segmentCount=split(name, segments, "/")
      if (segments[segmentCount] == "") segmentCount--
      if (segmentCount < 2) exit 11
      for (index=1; index<=segmentCount; index++) if (segments[index] == "" || segments[index] == "." || segments[index] == "..") exit 12
      if (root == "") root=segments[1]
      if (segments[1] != root) exit 13
      canonical=tolower(name); sub(/\/$/, "", canonical)
      if (seen[canonical]++) exit 14
      count++
    }
    END {
      if (count == 0) exit 15
      if (kind == "node" && root !~ /^node-v[0-9]+\.[0-9]+\.[0-9]+-(darwin-(arm64|x64)|win-x64)$/) exit 16
      if (kind == "llama" && root !~ /^llama-b[0-9]+$/) exit 17
      if (kind != "node" && kind != "llama") exit 18
    }
  ' "$aurora_archive_names"; then
    rm -f -- "$aurora_archive_names" "$aurora_archive_verbose"
    aurora_die "Arkivet har osäkra, dubbla eller rotöverskridande sökvägar: $(basename "$aurora_archive") / Archive has unsafe, duplicate, or root-escaping paths."
  fi
  if ! LC_ALL=C awk '
    BEGIN { count=0 }
    { type=substr($0,1,1); if (type != "-" && type != "d") exit 20; count++ }
    END { if (count == 0) exit 21 }
  ' "$aurora_archive_verbose"; then
    rm -f -- "$aurora_archive_names" "$aurora_archive_verbose"
    aurora_die "Arkivet innehåller länk, hårdlänk eller specialfil: $(basename "$aurora_archive") / Archive contains a link, hard link, or special file."
  fi
  aurora_name_count=$(wc -l < "$aurora_archive_names" | tr -d ' ')
  aurora_type_count=$(wc -l < "$aurora_archive_verbose" | tr -d ' ')
  rm -f -- "$aurora_archive_names" "$aurora_archive_verbose"
  [ "$aurora_name_count" -eq "$aurora_type_count" ] || aurora_die "Arkivlistorna är tvetydiga: $(basename "$aurora_archive") / Archive inventory is ambiguous."
}

aurora_node_bin() {
  aurora_platform_value=$(aurora_platform)
  case "$aurora_platform_value" in
    windows-x64) printf '%s\n' "$AURORA_ROOT/.runtime/node/node.exe" ;;
    *) printf '%s\n' "$AURORA_ROOT/.runtime/node/bin/node" ;;
  esac
}

aurora_pid_alive() {
  aurora_pid=$1
  case "$aurora_pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$aurora_pid" 2>/dev/null
}

aurora_pid_owned() {
  aurora_owned_pid=$1
  aurora_owned_fragment=${2:-}
  aurora_pid_alive "$aurora_owned_pid" || return 1
  aurora_owned_command=$(ps -p "$aurora_owned_pid" -o command= 2>/dev/null || true)
  case "$aurora_owned_command" in *"$AURORA_ROOT"*) ;; *) return 1 ;; esac
  if [ -n "$aurora_owned_fragment" ]; then
    case "$aurora_owned_command" in *"$aurora_owned_fragment"*) ;; *) return 1 ;; esac
  fi
}

aurora_safe_loopback_url() {
  aurora_url_candidate=$1
  case "$aurora_url_candidate" in http://127.0.0.1:*) aurora_url_port=${aurora_url_candidate#http://127.0.0.1:} ;; *) return 1 ;; esac
  case "$aurora_url_port" in ''|*[!0-9]*) return 1 ;; esac
  case "$aurora_url_port" in 0*) return 1 ;; esac
  [ "$aurora_url_port" -ge 1 ] 2>/dev/null && [ "$aurora_url_port" -le 65535 ] 2>/dev/null || return 1
  [ "$aurora_url_candidate" = "http://127.0.0.1:$aurora_url_port" ] || return 1
  printf '%s\n' "$aurora_url_candidate"
}

aurora_read_pid() {
  aurora_pid_file=$1
  [ -f "$aurora_pid_file" ] || return 1
  IFS= read -r aurora_pid_value < "$aurora_pid_file" || return 1
  case "$aurora_pid_value" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$aurora_pid_value"
}

aurora_open_browser() {
  aurora_url=$1
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) open "$aurora_url" >/dev/null 2>&1 & ;;
    MINGW*|MSYS*|CYGWIN*) cmd.exe /c start "" "$aurora_url" >/dev/null 2>&1 & ;;
    *) aurora_warn "Öppna adressen manuellt: $aurora_url / Open the URL manually: $aurora_url" ;;
  esac
}

aurora_open_local_file() {
  aurora_file=$1
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) open "$aurora_file" >/dev/null 2>&1 & ;;
    MINGW*|MSYS*|CYGWIN*) cmd.exe /c start "" "$aurora_file" >/dev/null 2>&1 & ;;
    *) aurora_warn "Öppna filen manuellt: $aurora_file / Open the file manually." ;;
  esac
}

aurora_find_llama() {
  aurora_llama_root=${1:-"$AURORA_ROOT/.runtime/llama"}
  find "$aurora_llama_root" -type f \( -name 'llama-server' -o -name 'llama-server.exe' -o -name 'server' -o -name 'server.exe' \) -print 2>/dev/null | head -n 1
}

aurora_config_get() {
  aurora_key=$1
  aurora_node=${2:-$(aurora_node_bin)}
  "$aurora_node" "$AURORA_ROOT/scripts/config-cli.mjs" get "$aurora_key"
}
