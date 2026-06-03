#!/usr/bin/env bash
# make-pdf.sh — turn the final report HTML into a faithful PDF.
# Tries engines best-first and falls back. The HTML embeds a print stylesheet
# that forces `print-color-adjust: exact`, so backgrounds/chips/gradients
# survive even command-line Chrome printing.
#
# Usage: bash make-pdf.sh <input.html> [output.pdf] [--portrait] [--shots DIR]
# Engine ladder:
#   1. Playwright Chromium (render-pdf.mjs)   — best fidelity + verification
#   2. System Chrome/Chromium --print-to-pdf  — good fidelity, no verify
#   3. WeasyPrint                             — layout may differ, last resort
#   4. Manual instructions                    — open + Cmd/Ctrl-P -> Save as PDF
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IN="${1:?usage: make-pdf.sh <input.html> [output.pdf] [--portrait] [--shots DIR]}"; shift || true
OUT="report.pdf"
if [[ "${1:-}" != "" && "${1:-}" != --* ]]; then OUT="$1"; shift || true; fi
EXTRA=()
while [[ "${1:-}" != "" ]]; do EXTRA+=("$1"); shift; done

[[ -f "$IN" ]] || { echo "make-pdf: input not found: $IN" >&2; exit 1; }

# Content lint on the source HTML (runs for every engine, before rendering):
#   - em dashes are banned in report copy (must be 0)
#   - flag an accidentally duplicated money string (a figure printed twice)
#   - report the .page section count for a quick eyeball
contentcheck() {
  local f="$1" sections em dup
  sections=$(grep -oE 'class="page([ "]|--)' "$f" | wc -l | tr -d ' ')
  em=$(grep -oF '—' "$f" | wc -l | tr -d ' ')
  dup=$(grep -oE 'A?\$[0-9,]+[[:space:]]+(<b>)?A?\$[0-9,]+' "$f" | wc -l | tr -d ' ')
  echo "make-pdf: $sections .page section(s)." >&2
  if [[ "$em" -gt 0 ]]; then echo "make-pdf: WARNING $em em-dash(es) in HTML, banned in report copy; replace before shipping." >&2
  else echo "make-pdf: em-dash check OK (0)." >&2; fi
  [[ "$dup" -gt 0 ]] && echo "make-pdf: WARNING $dup possible duplicated money string(s) (a figure printed twice). Check them." >&2 || true
}
contentcheck "$IN"

# Universal guard: expected .page blocks vs actual PDF pages (catches a page that
# spilled onto an extra sheet). Clipping is caught only by Playwright (§8).
pagecheck() {
  command -v pdfinfo >/dev/null 2>&1 || return 0
  local want got
  want=$(grep -oE 'class="page([ "]|--)' "$1" | wc -l | tr -d ' ')
  got=$(pdfinfo "$2" 2>/dev/null | awk '/^Pages:/{print $2}')
  [[ -z "$want" || -z "$got" ]] && return 0
  if [[ "$got" == "$want" ]]; then echo "make-pdf: page-count OK ($got == $want .page blocks)." >&2
  else echo "make-pdf: WARNING page-count mismatch — $want .page blocks but $got PDF pages; a page may have overflowed. Check it." >&2; fi
}

# ---- 1. Playwright -------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  echo "make-pdf: trying Playwright Chromium…" >&2
  node "$HERE/render-pdf.mjs" "$IN" "$OUT" ${EXTRA[@]+"${EXTRA[@]}"}
  rc=$?
  if [[ $rc -eq 0 || $rc -eq 2 ]]; then
    [[ $rc -eq 2 ]] && echo "make-pdf: PDF written but some pages overflow — fix content and re-run." >&2
    echo "make-pdf: wrote $OUT via Playwright." >&2
    exit $rc
  fi
  echo "make-pdf: Playwright unavailable (rc=$rc), falling back…" >&2
fi

# ---- 2. System Chrome / Chromium ----------------------------------------
CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
  if [[ -x "$c" ]] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
done

if [[ -n "$CHROME" ]]; then
  echo "make-pdf: using system Chrome: $CHROME" >&2
  # file:// needs an absolute path
  ABS="$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN")"
  "$CHROME" --headless=new --disable-gpu --no-sandbox \
    --no-pdf-header-footer --print-to-pdf-no-header \
    --print-to-pdf="$OUT" "file://$ABS" >/dev/null 2>&1
  if [[ -f "$OUT" ]]; then
    echo "make-pdf: wrote $OUT via system Chrome. Overflow/clipping NOT auto-verified (Playwright does that) — eyeball pages." >&2
    pagecheck "$IN" "$OUT"
    exit 0
  fi
  echo "make-pdf: system Chrome failed, falling back…" >&2
fi

# ---- 3. WeasyPrint -------------------------------------------------------
if command -v weasyprint >/dev/null 2>&1; then
  echo "make-pdf: using WeasyPrint (layout may differ from the browser preview)…" >&2
  weasyprint "$IN" "$OUT" && { echo "make-pdf: wrote $OUT via WeasyPrint." >&2; pagecheck "$IN" "$OUT"; exit 0; }
fi

# ---- 4. Manual -----------------------------------------------------------
cat >&2 <<EOF
make-pdf: no headless engine available.
The HTML is print-ready (embedded @page A4 landscape + print-color-adjust:exact).
To produce a faithful PDF manually:
  1. Open "$IN" in Chrome or Safari.
  2. Cmd/Ctrl-P -> Destination: Save as PDF.
  3. Layout: Landscape · Margins: None · "Background graphics": ON.
This reproduces the report exactly because it uses the same print stylesheet.
Optional one-time setup for automation:  npm i -D playwright && npx playwright install chromium
EOF
exit 4
