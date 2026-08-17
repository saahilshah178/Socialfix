#!/usr/bin/env bash
# Socialfix modal fixture — assertion runner for the gstack `browse` CLI.
#
# Drives ig-modal.html through its variants and prints one PASS/FAIL line per
# assertion (README.md lists the same checks with the reasoning behind each, if
# you'd rather run them by hand). Every assertion is a JS expression evaluated
# in the page that must print exactly `true`; anything else (false, an error,
# a stack trace) is a FAIL and the raw output is shown indented.
#
#   bash check.sh                 # all sections
#   bash check.sh A C             # only sections A and C
#   B=/path/to/browse SHOTS=/tmp/x bash check.sh
#
# Sections: A title=following (Feature 2 panel: placement, title, toggle)
#           B title=followers (Feature 7 panel via renderListSubsection)
#           C panelDelay=400  (panel lands after the dialog — still above the list)
#           D panel=0         (bare modal: ui.js injects nothing on its own)
#
# Needs: the browse daemon reachable via $B (default gstack location) and the
# fixture files next to this script. Screenshots land in $SHOTS (/tmp/bwi-fx).
set -u

FX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
B="${B:-$HOME/.claude/skills/gstack/browse/dist/browse}"
SHOTS="${SHOTS:-/tmp/bwi-fx}"
mkdir -p "$SHOTS"
if [ ! -x "$B" ]; then
  echo "browse binary not found at $B — set B=/path/to/browse" >&2
  exit 2
fi
WANT="${*:-A B C D}"
wants() { case " $WANT " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

PASS=0
FAIL=0

say() { printf '%s\n' "$*"; }
# browse's `js` wraps any code containing "await" in an async block that needs
# an explicit return — add it, so awaited expressions print their value.
run_js() {
  local expr="$1"
  case "$expr" in *await*) expr="return ($expr)";; esac
  "$B" js "$expr" 2>&1
}

# check <name>  (JS expression on stdin; must print exactly `true`)
check() {
  local name="$1" expr out
  expr="$(cat)"
  out="$(run_js "$expr")"
  if printf '%s\n' "$out" | grep -qx 'true'; then
    PASS=$((PASS + 1)); say "PASS  $name"
  else
    FAIL=$((FAIL + 1)); say "FAIL  $name"
    printf '%s\n' "$out" | sed 's/^/      /' | head -30
  fi
}
shot() {
  if "$B" screenshot "$SHOTS/$1.png" >/dev/null 2>&1; then say "SHOT  $SHOTS/$1.png"; fi
}
errors_dump() {
  say "      console --errors:"
  "$B" console --errors 2>&1 | sed 's/^/      /' | head -20
}
# open <query> [nowait]  — navigate; unless "nowait", wait for the injected
# panel's toggle (15s timeout → FAIL if it never appears); let layout settle.
open() {
  local q="$1" mode="${2:-wait}"
  say "---- open ?$q"
  if ! "$B" goto "file://$FX_DIR/ig-modal.html?$q" >/dev/null 2>&1; then
    FAIL=$((FAIL + 1)); say "FAIL  goto ?$q"; return 1
  fi
  "$B" viewport 1280x800 >/dev/null 2>&1 || true
  if [ "$mode" = wait ] && ! "$B" wait '.bwi-section__toggle' >/dev/null 2>&1; then
    FAIL=$((FAIL + 1))
    say "FAIL  attach ?$q — .bwi-section__toggle never appeared (panel not injected? script error?)"
    errors_dump
    return 1
  fi
  run_js "await __fx.settle(200)" >/dev/null
  return 0
}
tail_checks() {  # common end-of-section checks
  check "$1 idle: <20 mutations inside the card over 500ms (no observer feedback loop)" <<'JS'
(async()=>{let n=0;const mo=new MutationObserver(m=>{n+=m.length;});mo.observe(__fx.card,{childList:true,subtree:true,attributes:true});await new Promise(r=>setTimeout(r,500));mo.disconnect();return n<20;})()
JS
  check "$1 no page errors (window.onerror / unhandledrejection)" <<'JS'
(()=>__fx.errors.length===0)()
JS
  if [ "$FAIL" -gt 0 ]; then errors_dump; fi
}

"$B" viewport 1280x800 >/dev/null 2>&1 || true

# The toggle contract both panels must satisfy: expanded shows "▴ Hide"
# (aria-expanded=true, list visible); one click collapses to "▾ Show"
# (aria-expanded=false, bwi-section--collapsed, list display:none) with NOTHING
# in the toggle transformed (regression: the old CSS rotated the caret -90°,
# turning "Show" sideways and hiding the arrow); a second click restores.
TOGGLE_JS='(()=>{const a=__fx.toggleState();const b=__fx.clickToggle();const c=__fx.clickToggle();return a.present&&a.glyph==="▴"&&a.label==="Hide"&&a.ariaExpanded==="true"&&!a.collapsed&&a.listDisplay!=="none"&&b.glyph==="▾"&&b.label==="Show"&&b.ariaExpanded==="false"&&b.collapsed&&b.listDisplay==="none"&&b.caretTransform==="none"&&b.glyphTransform==="none"&&b.labelTransform==="none"&&c.glyph==="▴"&&c.label==="Hide"&&c.ariaExpanded==="true"&&!c.collapsed&&c.listDisplay!=="none";})()'

# ============================================================================
if wants A; then
say "==== A  title=following (Feature 2 panel via renderSubsection)"
if open "title=following"; then
check "A1 panel present: data-bwi=subsection, inside the card, 12 rows" <<'JS'
(()=>{const p=__fx.panelRoot;const r=__fx.rects();return !!p&&p.dataset.bwi==='subsection'&&r.panel.insideCard&&r.panel.rows===12;})()
JS
check "A2 panel sits ABOVE the native list (insertAboveList climbed past the flex-row wrapper), list still overflows" <<'JS'
(()=>{const r=__fx.rects();return r.panel.aboveList&&r.scroll.scrollHeight>r.scroll.clientHeight+20;})()
JS
check "A3 finish() wrote the count into the title (\"12 people don't follow you back\") and the progress line is hidden" <<'JS'
(()=>{const t=__fx.toggleState();return /12 people don.t follow you back/.test(t.title)&&(t.progressDisplay===null||t.progressDisplay==='none');})()
JS
check "A4 panel list is bounded (max-height <= 240px) and internally scrolling" <<'JS'
(()=>{const r=__fx.rects();const l=__fx.panelRoot.querySelector('.bwi-list');return r.panel.listHeight<=241&&getComputedStyle(l).overflowY==='auto'&&l.scrollHeight>l.clientHeight;})()
JS
check "A5 toggle expanded: glyph ▴, label Hide, aria-expanded=true, list visible" <<'JS'
(()=>{const t=__fx.toggleState();return t.present&&t.glyph==='▴'&&t.label==='Hide'&&t.ariaExpanded==='true'&&!t.collapsed&&t.listDisplay!=='none';})()
JS
shot "A5-expanded"
check "A6 click → collapsed: ▾ Show, aria-expanded=false, bwi-section--collapsed, list hidden, nothing rotated" <<'JS'
(()=>{const t=__fx.clickToggle();return t.glyph==='▾'&&t.label==='Show'&&t.ariaExpanded==='false'&&t.collapsed&&t.listDisplay==='none'&&t.caretTransform==='none'&&t.glyphTransform==='none'&&t.labelTransform==='none';})()
JS
shot "A6-collapsed"
check "A7 click again → expanded (▴ Hide, aria-expanded=true)" <<'JS'
(()=>{const t=__fx.clickToggle();return t.glyph==='▴'&&t.label==='Hide'&&t.ariaExpanded==='true'&&!t.collapsed&&t.listDisplay!=='none';})()
JS
check "A8 collapsing frees the space: panel is shorter while collapsed" <<'JS'
(()=>{const a=__fx.toggleState().panelHeight;const b=__fx.clickToggle().panelHeight;const c=__fx.clickToggle().panelHeight;return b<a-50&&Math.abs(c-a)<=1;})()
JS
check "A9 reopen() → a fresh dialog gets a fresh panel above its list with the toggle expanded" <<'JS'
(async()=>{const r=await __fx.reopen();const t=__fx.toggleState();return r.panel.aboveList&&r.panel.rows===12&&t.glyph==='▴'&&!t.collapsed;})()
JS
tail_checks A
fi
fi

# ============================================================================
if wants B; then
say "==== B  title=followers (Feature 7 panel via renderListSubsection)"
if open "title=followers"; then
check "B1 panel: data-bwi=unfollowers, note present, 12 rows, sits above the list" <<'JS'
(()=>{const p=__fx.panelRoot;const r=__fx.rects();return !!p&&p.dataset.bwi==='unfollowers'&&!!p.querySelector('.bwi-section__note')&&r.panel.rows===12&&r.panel.aboveList;})()
JS
check "B2 title is the caller's text (\"89 accounts no longer follow you\")" <<'JS'
(()=>__fx.toggleState().title==='89 accounts no longer follow you')()
JS
check "B3 toggle contract on this panel too: ▴ Hide → ▾ Show (collapsed, list hidden, nothing rotated) → ▴ Hide" <<JS
$TOGGLE_JS
JS
shot "B-followers"
tail_checks B
fi
fi

# ============================================================================
if wants C; then
say "==== C  panelDelay=400 (panel inserted after the dialog exists)"
if open "panelDelay=400"; then
check "C1 late panel still lands above the list, inside the card" <<'JS'
(async()=>{await __fx.panelReady;await __fx.settle(100);const r=__fx.rects();return !!r.panel&&r.panel.aboveList&&r.panel.insideCard;})()
JS
check "C2 toggle contract holds for a late-inserted panel" <<JS
$TOGGLE_JS
JS
tail_checks C
fi
fi

# ============================================================================
if wants D; then
say "==== D  panel=0 (bare native modal)"
if open "panel=0" nowait; then
check "D1 no panel and no bwi- markup anywhere in the card (ui.js injects nothing on its own)" <<'JS'
(()=>{const r=__fx.rects();return r.panel===null&&__fx.card.querySelectorAll('[class*="bwi-"],[data-bwi]').length===0;})()
JS
check "D2 native list intact: 60 rows, overflows its 356px box" <<'JS'
(()=>{const r=__fx.rects();return r.scroll.rowsMounted===60&&r.scroll.inlineHeight==='356px'&&r.scroll.scrollHeight>r.scroll.clientHeight+20;})()
JS
tail_checks D
fi
fi

# ============================================================================
say ""
say "==== summary: $PASS passed, $FAIL failed  (screenshots in $SHOTS)"
[ "$FAIL" -eq 0 ]
