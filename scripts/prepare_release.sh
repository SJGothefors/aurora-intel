#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
aurora_assert_root

signing_key=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --signing-key) [ "$#" -ge 2 ] || aurora_die "--signing-key kräver en sökväg. / --signing-key requires a path."; signing_key=$2; shift 2 ;;
    -h|--help) printf '%s\n' "Usage: scripts/prepare_release [--signing-key ED25519_PRIVATE_KEY.pem]"; exit 0 ;;
    *) aurora_die "Okänt argument: $1 / Unknown argument: $1" ;;
  esac
done
[ -z "$signing_key" ] || [ -r "$signing_key" ] || aurora_die "Signeringsnyckeln kan inte läsas. / Signing key is not readable."

command -v curl >/dev/null 2>&1 || aurora_die "curl krävs på online-datorn. / curl is required on the online computer."
platform=$(aurora_platform)
case "$platform" in macos-arm64|macos-x64) ;; *) aurora_die "Använd prepare_release.ps1 på Windows. / Use prepare_release.ps1 on Windows." ;; esac
[ -f "$AURORA_ROOT/package.json" ] || aurora_die "package.json saknas. / package.json is missing."
[ -f "$AURORA_ROOT/package-lock.json" ] || aurora_die "package-lock.json saknas; skapa och granska låsfilen innan release. / package-lock.json is missing; create and review the lockfile before release."
[ -s "$AURORA_ROOT/assets/model/Mistral-7B-Instruct-v0.3-LICENSE.txt" ] && [ -s "$AURORA_ROOT/assets/model/README.md" ] || aurora_die "Modellens licens/proveniens saknas. / Model license or provenance is missing."

release_version=$(sed -n 's/.*"appVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$AURORA_ROOT/config/app.defaults.json" | head -n 1)
[ -n "$release_version" ] || aurora_die "appVersion saknas i config/app.defaults.json. / appVersion is missing."
release_root="$AURORA_ROOT/applicationExportFolder"
artifact_cache="$AURORA_ROOT/.cache/release-artifacts"
mkdir -p "$release_root" "$artifact_cache"
work=$(mktemp -d "$release_root/.prepare.XXXXXX")
stage="$work/aurora-intel-v$release_version-offline"
mkdir -p "$stage"
cleanup_prepare() { rm -rf -- "$work" 2>/dev/null || true; }
trap cleanup_prepare EXIT HUP INT TERM

aurora_info "Kopierar releasekällor ... / Copying release sources ..."
for item in scripts server web assets config knowledge docs tests vendor package.json package-lock.json README.md LICENSE NOTICE build.command build.sh build.bat start.command start.sh start.bat stop.command stop.sh stop.bat teardown.command teardown.sh teardown.bat; do
  [ -e "$AURORA_ROOT/$item" ] || continue
  cp -R "$AURORA_ROOT/$item" "$stage/"
done
# Runtime-local settings are never part of a distributable release, even if
# prepare_release is run from a previously used development checkout.
rm -f -- "$stage/config/app.local.json"
mkdir -p "$stage/runtime/payload" "$stage/llm/payload" "$stage/llm/models" "$stage/offline/npm-cache" "$stage/exports"

aurora_info "Hämtar och verifierar pinnade artefakter ... / Downloading and verifying pinned artifacts ..."
while IFS='|' read -r artifact_id artifact_platform artifact_kind artifact_filename artifact_url artifact_sha artifact_destination || [ -n "${artifact_id:-}" ]; do
  case "${artifact_id:-}" in ''|'#'*) continue ;; esac
  case "$artifact_url" in https://*) ;; *) aurora_die "Endast HTTPS tillåts i versions.lock: $artifact_id / Only HTTPS is allowed." ;; esac
  case "$artifact_sha" in *[!0-9a-fA-F]*|'') aurora_die "Ogiltig SHA-256 för $artifact_id. / Invalid SHA-256." ;; esac
  [ ${#artifact_sha} -eq 64 ] || aurora_die "Ogiltig SHA-256 för $artifact_id. / Invalid SHA-256."
  case "$artifact_destination" in ''|/*|../*|*/../*|*/..) aurora_die "Osäker destinationssökväg för $artifact_id. / Unsafe artifact destination." ;; esac
  cached="$artifact_cache/$artifact_filename"
  if [ -f "$cached" ] && [ "$(aurora_sha256 "$cached")" != "$(printf '%s' "$artifact_sha" | tr 'A-F' 'a-f')" ]; then
    mv "$cached" "$cached.invalid.$(date '+%Y%m%d%H%M%S')"
  fi
  if [ ! -f "$cached" ]; then
    aurora_info "  $artifact_id ($artifact_filename)"
    partial="$cached.part"
    curl -fL --retry 4 --retry-delay 2 --retry-all-errors --continue-at - --output "$partial" "$artifact_url"
    if [ "$(aurora_sha256 "$partial")" != "$(printf '%s' "$artifact_sha" | tr 'A-F' 'a-f')" ]; then
      mv "$partial" "$partial.invalid.$(date '+%Y%m%d%H%M%S')"
      aurora_die "SHA-256 stämmer inte för $artifact_id. / SHA-256 mismatch for $artifact_id."
    fi
    mv "$partial" "$cached"
  fi
  [ "$(aurora_sha256 "$cached")" = "$(printf '%s' "$artifact_sha" | tr 'A-F' 'a-f')" ] || aurora_die "SHA-256 stämmer inte för $artifact_id. / SHA-256 mismatch for $artifact_id."
  case "$artifact_kind" in
    node|llama)
      tar -tf "$cached" 2>/dev/null | awk 'BEGIN{found=0} {name=$0; sub(/^.*\//,"",name); if (name == "LICENSE" || name ~ /^LICENSE\./) found=1} END{exit(found ? 0 : 1)}' || aurora_die "Licensfil saknas i arkivet för $artifact_id. / Embedded license file is missing from the $artifact_id archive."
      ;;
  esac
  mkdir -p "$stage/$(dirname "$artifact_destination")"
  cp -p "$cached" "$stage/$artifact_destination"
done < "$AURORA_ROOT/config/versions.lock"

node_archive="$stage/runtime/payload/node-$platform.tar.gz"
[ -f "$node_archive" ] || aurora_die "Node-runtime för byggdatorn saknas. / Node runtime for the build host is missing."
toolchain="$work/toolchain"
mkdir "$toolchain"
tar -xzf "$node_archive" --strip-components=1 -C "$toolchain"
tool_node="$toolchain/bin/node"
npm_cli="$toolchain/lib/node_modules/npm/bin/npm-cli.js"
[ -x "$tool_node" ] && [ -f "$npm_cli" ] || aurora_die "Portabel Node kunde inte packas upp. / Portable Node could not be unpacked."

aurora_info "Fyller npm-lagret för installation utan nät ... / Populating npm store for network-free installation ..."
"$tool_node" "$stage/scripts/cache-packages.mjs" "$stage/package-lock.json" "$stage/offline/npm-cache" "$npm_cli"
(
  cd "$stage"
  npm_config_update_notifier=false npm_config_audit=false npm_config_cache="$stage/offline/npm-cache" "$tool_node" "$npm_cli" ci --offline --cache "$stage/offline/npm-cache" --ignore-scripts --no-audit --no-fund
  if "$tool_node" -e 'const p=require("./package.json");process.exit(p.scripts?.check?0:1)'; then
    "$tool_node" "$npm_cli" run check
  else
    "$tool_node" "$npm_cli" run build
    "$tool_node" "$stage/scripts/offline-guard.mjs" "$stage/web/dist"
    "$tool_node" "$npm_cli" run test:licenses --if-present
  fi
)
[ -f "$stage/web/dist/index.html" ] || aurora_die "Frontendbygget saknar web/dist/index.html. / Frontend build is missing web/dist/index.html."
"$tool_node" "$stage/scripts/offline-guard.mjs" "$stage/web/dist"
rm -rf -- "$stage/node_modules"

aurora_info "Skapar maskinläsbar komponentförteckning ... / Creating machine-readable component inventory ..."
"$tool_node" "$stage/scripts/make-sbom.mjs" "$stage"
[ -s "$stage/docs/release/aurora-intel.cdx.json" ] || aurora_die "CycloneDX-SBOM kunde inte skapas. / CycloneDX SBOM could not be created."

cat > "$stage/RELEASE_READY.txt" <<'EOF'
AURORA INTEL — OFFLINE RELEASE

SV: Detta är ett komplett USB-paket förutsatt att `build` godkänner alla
kontrollsummor och självtester. Packa upp hela mappen på måldatorn, kör
build.command (macOS) eller build.bat (Windows), därefter start.command/start.bat.

EN: This is a complete USB package provided `build` passes every checksum and
self-test. Extract the entire folder on the target, run build.command (macOS)
or build.bat (Windows), then start.command/start.bat.
EOF

"$tool_node" "$stage/scripts/make-checksums.mjs" "$stage"
final="$release_root/aurora-intel-v$release_version-offline"
if [ -e "$final" ]; then
  mv "$final" "$final.previous.$(date '+%Y%m%d%H%M%S')"
fi
mv "$stage" "$final"
archive_tmp="$work/aurora-intel-v$release_version-offline.zip"
if command -v ditto >/dev/null 2>&1; then
  ditto -c -k --sequesterRsrc --keepParent "$final" "$archive_tmp"
elif command -v zip >/dev/null 2>&1; then
  (cd "$release_root" && zip -q -r "$archive_tmp" "$(basename "$final")")
else
  aurora_die "Varken ditto eller zip finns. Releasemappen är komplett men zip kunde inte skapas. / Neither ditto nor zip is available."
fi
"$tool_node" "$final/scripts/fix-zip-permissions.mjs" "$archive_tmp"
archive="$release_root/aurora-intel-v$release_version-offline.zip"
[ ! -e "$archive" ] || mv "$archive" "$archive.previous.$(date '+%Y%m%d%H%M%S')"
mv "$archive_tmp" "$archive"
archive_sha=$(aurora_sha256 "$archive")
printf '%s  %s\n' "$archive_sha" "$(basename "$archive")" > "$release_root/checksums.txt"
if [ -n "$signing_key" ]; then
  "$tool_node" "$final/scripts/release-signature.mjs" sign "$archive" "$archive_sha" "$signing_key" "$archive.sig.json" "$archive.pub.pem"
fi
"$tool_node" "$final/scripts/verify-release-output.mjs" "$release_root" "$release_version"
trap - EXIT HUP INT TERM
rm -rf -- "$work"
aurora_info "OK — Offlinepaket: $final"
aurora_info "ZIP: $archive"
aurora_info "Kopiera ZIP-filen (eller hela releasemappen) till USB. / Copy the ZIP (or entire release folder) to USB."
