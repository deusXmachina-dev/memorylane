#!/usr/bin/env bash
# make-pdf.sh — turn the final report HTML into a faithful PDF.
# Tries engines best-first and falls back. The HTML embeds a print stylesheet
# that forces `print-color-adjust: exact`, so backgrounds/chips/gradients
# survive even command-line Chrome printing.
#
# Usage: bash make-pdf.sh <input.html> [output.pdf] [--portrait] [--shots DIR]
# Engine ladder:
#   1. Playwright Chromium (render-pdf.mjs)   — best fidelity + verification
#   2. System Chrome/Edge --print-to-pdf      — good fidelity, overflow check, no PNGs
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
# spilled onto an extra sheet). Falls back to counting page objects without pdfinfo.
pagecheck() {
  local want got
  want=$(grep -oE 'class="page([ "]|--)' "$1" | wc -l | tr -d ' ')
  if command -v pdfinfo >/dev/null 2>&1; then
    got=$(pdfinfo "$2" 2>/dev/null | awk '/^Pages:/{print $2}')
  else
    got=$(LC_ALL=C grep -aoE '/Type */Pages?' "$2" | grep -c '/Page$')
  fi
  if [[ -z "$want" || -z "$got" || "$got" == 0 ]]; then
    echo "make-pdf: WARNING page count not checked; compare it by hand." >&2
    return 0
  fi
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
    pagecheck "$IN" "$OUT"
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
  "/c/Program Files/Google/Chrome/Application/chrome.exe" \
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
  "${LOCALAPPDATA:-}/Google/Chrome/Application/chrome.exe" \
  "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
  google-chrome google-chrome-stable chromium chromium-browser microsoft-edge chrome msedge; do
  if [[ -x "$c" ]] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
done

# Same measurement as render-pdf.mjs, on a throwaway copy with a probe script.
overflowcheck() {
  local dir probe found
  dir="$(cd "$(dirname "$IN")" && { pwd -W 2>/dev/null || pwd; })"
  probe=".overflow-probe-$$.html"
  { cat "$IN"; printf '%s' "<script>addEventListener('load',()=>{document.documentElement.setAttribute('data-overflow',[...document.querySelectorAll('.page:not(.page--flow)')].map((e,i)=>[i+1,e.scrollHeight-e.clientHeight]).filter(x=>x[1]>2).map(x=>'#'+x[0]+' (+'+x[1]+'px)').join(', ')||'none')})</script>"; } > "$(dirname "$IN")/$probe"
  found=$("$CHROME" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=5000 \
    --dump-dom "file:///${dir#/}/$probe" 2>/dev/null | grep -oE 'data-overflow="[^"]*"')
  rm -f "$(dirname "$IN")/$probe"
  found="${found#data-overflow=\"}"; found="${found%\"}"
  if [[ -z "$found" ]]; then
    echo "make-pdf: WARNING overflow not checked; eyeball every page." >&2
  elif [[ "$found" == none ]]; then
    echo "make-pdf: overflow check OK." >&2
  else
    echo "make-pdf: page(s) overflow the sheet: $found. Split them across more .page blocks." >&2
    return 2
  fi
}

if [[ -n "$CHROME" ]]; then
  echo "make-pdf: using system browser: $CHROME" >&2
  # file:// needs an absolute path
  ABS="$(cd "$(dirname "$IN")" && { pwd -W 2>/dev/null || pwd; })/$(basename "$IN")"
  TMP="$OUT.tmp"
  rm -f "$TMP"
  "$CHROME" --headless=new --disable-gpu --no-sandbox \
    --no-pdf-header-footer --print-to-pdf-no-header \
    --print-to-pdf="$TMP" "file:///${ABS#/}" >/dev/null 2>&1
  if [[ -s "$TMP" ]]; then
    mv -f "$TMP" "$OUT"
    echo "make-pdf: wrote $OUT via system browser. No page PNGs; Read the PDF's pages to check them." >&2
    overflowcheck
    rc=$?
    pagecheck "$IN" "$OUT"
    exit $rc
  fi
  rm -f "$TMP"
  echo "make-pdf: system browser failed, falling back…" >&2
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
EOF
exit 4
