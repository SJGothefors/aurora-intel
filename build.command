#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$ROOT/build.sh" "$@"
status=$?
if [ "$status" -ne 0 ] && [ -t 0 ]; then
  printf '\nTryck Retur / Press Return ...'
  read -r _
fi
exit "$status"
