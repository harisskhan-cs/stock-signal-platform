#!/usr/bin/env bash
# Rebuilds the subset fonts in src/fonts from the full @fontsource files.
#
# Iosevka ships thousands of glyphs (~1 MB per weight). The app only needs
# basic Latin, Latin-1 (for £, ×, ·), dashes and quotes, the minus sign, and
# the ▲ ▼ ● markers, so subsetting cuts each file to a few dozen KB.
#
# Requires fonttools with brotli: pip install fonttools brotli
set -euo pipefail
cd "$(dirname "$0")/.."

UNICODES="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+2190-2193,U+2212,U+20AC,U+2122,U+25B2,U+25BC,U+25CF"
SRC=../node_modules/@fontsource
mkdir -p src/fonts

for family in iosevka iosevka-aile; do
  for weight in 400 600; do
    pyftsubset "$SRC/$family/files/$family-latin-$weight-normal.woff2" \
      --unicodes="$UNICODES" \
      --layout-features='kern,tnum,case' \
      --flavor=woff2 \
      --output-file="src/fonts/$family-$weight.woff2"
  done
done

ls -l src/fonts
