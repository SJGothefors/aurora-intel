#!/bin/sh
set -eu
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/common.sh"
aurora_assert_root

no_export=0
purge_exports=0
for aurora_arg in "$@"; do
  case "$aurora_arg" in
    --no-export) no_export=1 ;;
    --purge-exports) purge_exports=1 ;;
    -h|--help) printf '%s\n' "Usage: scripts/teardown.sh [--no-export] [--purge-exports]"; exit 0 ;;
    *) aurora_die "Okänt argument: $aurora_arg / Unknown argument: $aurora_arg" ;;
  esac
done

if [ "$purge_exports" -eq 1 ]; then
  printf '%s\n' "TOTAL RADERING / TOTAL WIPE"
  printf '%s\n' "Detta tar även bort alla sparade exporter. Skriv exakt: RADERA AURORA"
  printf '%s\n' "This also removes every saved export. Type exactly: RADERA AURORA"
  IFS= read -r confirmation
  [ "$confirmation" = "RADERA AURORA" ] || aurora_die "Bekräftelsen stämde inte; inget har raderats. / Confirmation did not match; nothing was deleted."
fi

"$AURORA_ROOT/scripts/stop.sh"
db="$AURORA_ROOT/data/aurora.db"
if [ "$no_export" -eq 0 ] && [ -f "$db" ]; then
  node_bin=$(aurora_node_bin)
  [ -x "$node_bin" ] || aurora_die "Kan inte skapa slutexport: portabel Node saknas. Data har inte raderats. / Cannot make final export: portable Node is missing. Data was not deleted."
  timestamp=$(date '+%Y%m%d-%H%M')
  mkdir -p "$AURORA_ROOT/exports"
  xlsx="$AURORA_ROOT/exports/aurora-final-$timestamp.xlsx"
  csv="$AURORA_ROOT/exports/aurora-final-$timestamp.csv"
  aurora_info "Skapar slutexport ... / Creating final export ..."
  "$node_bin" "$AURORA_ROOT/server/index.mjs" --root "$AURORA_ROOT" --data-dir "$AURORA_ROOT/data" --export "$xlsx" || aurora_die "XLSX-exporten misslyckades; data har inte raderats. / XLSX export failed; data was not deleted."
  "$node_bin" "$AURORA_ROOT/server/index.mjs" --root "$AURORA_ROOT" --data-dir "$AURORA_ROOT/data" --export "$csv" || aurora_die "CSV-exporten misslyckades; data har inte raderats. / CSV export failed; data was not deleted."
  [ -s "$xlsx" ] && [ -s "$csv" ] || aurora_die "Slutexporten blev tom; data har inte raderats. / Final export was empty; data was not deleted."
  aurora_info "Sparat: exports/$(basename "$xlsx") och $(basename "$csv") / Saved final exports."
elif [ "$no_export" -eq 0 ]; then
  aurora_info "Ingen databas finns; slutexport hoppas över. / No database exists; final export skipped."
else
  aurora_warn "Slutexport hoppades över med --no-export. / Final export skipped with --no-export."
fi

# Exact, repository-relative targets only. Release payload and built frontend are deliberately preserved.
rm -rf -- "$AURORA_ROOT/data" "$AURORA_ROOT/.runtime" "$AURORA_ROOT/node_modules" "$AURORA_ROOT/.cache"
rm -f -- "$AURORA_ROOT/config/app.local.json"
if [ "$purge_exports" -eq 1 ]; then
  rm -rf -- "$AURORA_ROOT/exports"
  aurora_warn "Alla data och exporter har raderats permanent. / All data and exports were permanently deleted."
else
  aurora_info "Lokalt tillstånd är borttaget; källkod, releasepayload och exporter finns kvar. / Local state removed; source, release payload, and exports remain."
  aurora_info "Kör build --restore-latest för att återställa senaste snapshot. / Run build --restore-latest to restore the latest snapshot."
fi
