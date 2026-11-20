#!/usr/bin/env bash
# Every image a Dockerfile names (FROM, COPY --from, RUN --mount from=) must be a digest or an
# earlier stage: a tag is a promise someone else can change. Instructions are case-insensitive;
# ARG defaults used in FROM are resolved.
#
#   check-pinned.sh <Dockerfile>...
set -euo pipefail
[ "$#" -gt 0 ] || { echo "usage: check-pinned.sh <Dockerfile>..." >&2; exit 2; }
for file in "$@"; do
  stages=" "
  found=0
  args=""
  while IFS= read -r line; do
    refs=""
    name=""
    if printf '%s\n' "$line" | grep -qiE '^[[:space:]]*ARG[[:space:]]+[A-Za-z_][A-Za-z0-9_]*='; then
      args="$args $(printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[Aa][Rr][Gg][[:space:]]+//')"
    fi
    if printf '%s\n' "$line" | grep -qiE '^[[:space:]]*FROM[[:space:]]'; then
      found=1
      refs="$(printf '%s\n' "$line" | awk '{for (i = 2; i <= NF; i++) if ($i !~ /^--/) { print $i; break }}')"
      name="$(printf '%s\n' "$line" | sed -nE 's/.*[[:space:]][Aa][Ss][[:space:]]+([^[:space:]]+)[[:space:]]*$/\1/p')"
    fi
    refs="$refs $(printf '%s\n' "$line" | grep -oiE -- '(--|,)from=[^[:space:],]+' | sed -E 's/^(--|,)[Ff][Rr][Oo][Mm]=//' || true)"
    for ref in $refs; do
      # ${NAME} or $NAME from an ARG default declared earlier in the file.
      if printf '%s' "$ref" | grep -qE '^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$'; then
        var="$(printf '%s' "$ref" | tr -d '${}')"
        val=""
        for kv in $args; do case "$kv" in "$var="*) val="${kv#*=}" ;; esac; done
        [ -n "$val" ] || { echo "::error file=$file::$ref has no ARG default to check"; exit 1; }
        ref="$val"
      fi
      case "$stages" in *" $ref "*) continue ;; esac
      [ "$ref" = scratch ] && continue
      printf '%s' "$ref" | grep -qE '^[0-9]+$' && continue
      printf '%s' "$ref" | grep -qE '@sha256:[0-9a-f]{64}$' || { echo "::error file=$file::$ref is not pinned by digest"; exit 1; }
    done
    [ -z "$name" ] || stages="$stages$name "
  done < "$file"
  [ "$found" = 1 ] || { echo "::error file=$file::no FROM found"; exit 1; }
  echo "$file: every image reference is a digest or an earlier stage"
done
