#!/usr/bin/env bash
# Socialfix modal fixture — assertion runner for the gstack `browse` CLI.
#
# Drives ig-modal.html through every variant and prints one PASS/FAIL line per
# assertion (README.md lists the same checks with the reasoning behind each, if
# you'd rather run them by hand). Every assertion is a JS expression evaluated
# in the page that must print exactly `true`; anything else (false, an error,
# a stack trace) is a FAIL and the raw output is shown indented.
#
#   bash check.sh                 # all sections
#   bash check.sh A C             # only sections A and C
#   B=/path/to/browse SHOTS=/tmp/x bash check.sh
#
# Sections: A fixed+following (attach, toggle, drags, clamp, reset, persist)
#           B centered=0 (1x drag factor)      C mode=flex
#           D mode=window (rollback)           E mode=clip (rollback)
#           F title=followers                  G panel=0
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
WANT="${*:-A B C D E F G}"
wants() { case " $WANT " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

PASS=0
FAIL=0
SOFT=0

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
# soft <name>  — an expectation the contract leaves open; reported, not counted as FAIL
soft() {
  local name="$1" expr out
  expr="$(cat)"
  out="$(run_js "$expr")"
  if printf '%s\n' "$out" | grep -qx 'true'; then
    say "PASS  $name (soft)"
  else
    SOFT=$((SOFT + 1)); say "SOFT  $name — not as expected:"
    printf '%s\n' "$out" | sed 's/^/      /' | head -30
  fi
}
info() {
  local name="$1" expr
  expr="$(cat)"
  say "INFO  $name"
  run_js "$expr" | sed 's/^/      /' | head -60
}
shot() {
  if "$B" screenshot "$SHOTS/$1.png" >/dev/null 2>&1; then say "SHOT  $SHOTS/$1.png"; fi
}
errors_dump() {
  say "      console --errors:"
  "$B" console --errors 2>&1 | sed 's/^/      /' | head -20
}
# open <query>  — navigate, wait for feature3's handle layer, let it settle
open() {
  local q="$1"
  say "---- open ?$q"
  if ! "$B" goto "file://$FX_DIR/ig-modal.html?$q" >/dev/null 2>&1; then
    FAIL=$((FAIL + 1)); say "FAIL  goto ?$q"; return 1
  fi
  # Re-assert the viewport now that a page exists (the first call may have run
  # against no page); the height budget below assumes 1280x1100.
  "$B" viewport 1280x1100 >/dev/null 2>&1 || true
  if ! "$B" wait '.bwi-resize-layer' >/dev/null 2>&1; then
    FAIL=$((FAIL + 1))
    say "FAIL  attach ?$q — .bwi-resize-layer never appeared (feature3 not attached: RESIZABLE_MODALS off? dialog/list not detected? script error?)"
    errors_dump
    return 1
  fi
  run_js "await __fx.settle(300)" >/dev/null
  return 0
}
# fresh <query> — open, wipe chrome.storage, open again (no stale stored size)
fresh() {
  open "$1" || return 1
  run_js "__fx.resetStorage(); true" >/dev/null
  open "$1"
}
tail_checks() {  # common end-of-section checks
  check "$1 idle: <20 mutations inside the card over 500ms (no observer feedback loop)" <<'JS'
(async()=>{let n=0;const mo=new MutationObserver(m=>{n+=m.length;});mo.observe(__fx.card,{childList:true,subtree:true,attributes:true});await new Promise(r=>setTimeout(r,500));mo.disconnect();window.__fxIdle=n;return n<20;})()
JS
  check "$1 no page errors (window.onerror / unhandledrejection)" <<'JS'
(()=>__fx.errors.length===0)()
JS
  if [ "$FAIL" -gt 0 ]; then errors_dump; fi
}

# 1280x1100: tall enough that A's cumulative vertical drags (+80, +80) stay
# under feature3's 95vh clamp with the 12-row panel in the card.
"$B" viewport 1280x1100 >/dev/null 2>&1 || true

# ============================================================================
if wants A; then
say "==== A  mode=fixed title=following (centered)"
if fresh "mode=fixed"; then
check "A0 viewport is 1280x1100 (feature3 clamps height to 95vh; A's drags need the room) and the card is centered" <<'JS'
(()=>{const v=__fx.viewportInfo();return v.innerWidth===1280&&v.innerHeight===1100&&v.cardCenteredX&&v.cardCenteredY;})()
JS
check "A1 layer present, 8 handles with data-dir, card has bwi-big-card + bwi-resizable" <<'JS'
(()=>{const r=__fx.rects();return r.resize.layer&&r.resize.handles===8&&r.resize.resizable&&r.resize.bigCard&&['n','s','e','w','ne','nw','se','sw'].every(d=>r.resize.handleDirs.includes(d));})()
JS
check "A2 layer is the card's last child, data-bwi=resize, and its box == the card's box" <<'JS'
(()=>{const r=__fx.rects();const l=__fx.card.lastElementChild;const a=r.resize.layerRect,c=r.card;return !!l&&l.classList.contains('bwi-resize-layer')&&l.dataset.bwi==='resize'&&!!a&&Math.abs(a.x-c.x)<=1&&Math.abs(a.y-c.y)<=1&&Math.abs(a.w-c.w)<=1&&Math.abs(a.h-c.h)<=1;})()
JS
check "A3 card was made a containing block (position != static; fixture leaves it static)" <<'JS'
(()=>__fx.rects().card.position!=='static')()
JS
check "A4 native list still detected (overflows) and the panel sits ABOVE it" <<'JS'
(()=>{const r=__fx.rects();return !!r.panel&&r.panel.aboveList&&r.scroll.scrollHeight>r.scroll.clientHeight+20;})()
JS
check "A5 toggle expanded: glyph ▴, label Hide, aria-expanded=true, list visible" <<'JS'
(()=>{const t=__fx.toggleState();return t.present&&t.glyph==='▴'&&t.label==='Hide'&&t.ariaExpanded==='true'&&!t.collapsed&&t.listDisplay!=='none';})()
JS
shot "A5-expanded"
check "A6 click → collapsed: ▾ Show aria-expanded=false, bwi-section--collapsed, list hidden, nothing rotated" <<'JS'
(()=>{const t=__fx.clickToggle();return t.glyph==='▾'&&t.label==='Show'&&t.ariaExpanded==='false'&&t.collapsed&&t.listDisplay==='none'&&t.caretTransform==='none'&&t.glyphTransform==='none'&&t.labelTransform==='none';})()
JS
shot "A6-collapsed"
check "A7 click again → expanded (▴ Hide, aria-expanded=true)" <<'JS'
(()=>{const t=__fx.clickToggle();return t.glyph==='▴'&&t.label==='Hide'&&t.ariaExpanded==='true'&&!t.collapsed&&t.listDisplay!=='none';})()
JS
run_js "window.__fxNat=__fx.rects().card; true" >/dev/null
check "A8 drag se (+60,+40) centered → card +120 x +80, inline width/height !important, stored {w,h} == card" <<'JS'
(async()=>{const d=await __fx.drag('se',60,40);window.__fxD=d;return Math.abs(d.delta.cardW-120)<=2&&Math.abs(d.delta.cardH-80)<=2&&d.after.card.inlineWidthPriority==='important'&&d.after.card.inlineHeightPriority==='important'&&!!d.storedSize&&Math.abs(d.storedSize.w-d.after.card.w)<=2&&Math.abs(d.storedSize.h-d.after.card.h)<=2;})()
JS
check "A9 fixed mode: list got its own inline height and grew (60/40 with the panel), and its bottom stays inside the card (nothing spills)" <<'JS'
(()=>{const d=window.__fxD;return d.after.scroll.inlineHeight!==''&&d.after.scroll.inlineHeight!=='356px'&&d.delta.scrollH>0&&(d.delta.panelListH||0)>0&&d.after.scroll.bottom<=d.after.card.bottom+1;})()
JS
check "A10 --bwi-list-max set on the card after a vertical resize" <<'JS'
(()=>__fx.rects().card.listMax!=='')()
JS
check "A11 body.bwi-resizing + data-bwi-cursor were set during the press" <<'JS'
(()=>{const d=window.__fxD;return d.duringDown.bodyResizing===true&&typeof d.duringDown.cursor==='string'&&d.duringDown.cursor.length>0&&d.after.resize.bodyResizing===false;})()
JS
info "A state() after the first drag" <<'JS'
__fx.state()
JS
shot "A8-after-drag-se"
check "A12 drag n (0,-40) → height +80, width unchanged" <<'JS'
(async()=>{const d=await __fx.drag('n',0,-40);return Math.abs(d.delta.cardH-80)<=2&&Math.abs(d.delta.cardW)<=1;})()
JS
check "A13 drag w (-50,0) → width +100, height unchanged" <<'JS'
(async()=>{const d=await __fx.drag('w',-50,0);return Math.abs(d.delta.cardW-100)<=2&&Math.abs(d.delta.cardH)<=1;})()
JS
check "A14 shrink: drag se (-30,-20) → card -60 x -40 (negative deltas, still above content height)" <<'JS'
(async()=>{const d=await __fx.drag('se',-30,-20);return Math.abs(d.delta.cardW+60)<=2&&Math.abs(d.delta.cardH+40)<=2;})()
JS
check "A15 dblclick a handle → back to natural size (400 wide, natural height), inline size gone" <<'JS'
(async()=>{const d=await __fx.dblclickHandle('se');window.__fxReset=d;const n=window.__fxNat;return Math.abs(d.after.card.w-n.w)<=1&&Math.abs(d.after.card.h-n.h)<=2&&d.after.card.inlineWidth===''&&d.after.card.inlineHeight==='';})()
JS
check "A16 dblclick reset removed the stored size" <<'JS'
(()=>__fx.storedSize()==null)()
JS
check "A17 drag se (+40,+30), then reopen() → the NEW dialog gets the stored size" <<'JS'
(async()=>{const d=await __fx.drag('se',40,30);const w=d.after.card.w,h=d.after.card.h;window.__fxKeep={w,h};const r=await __fx.reopen();return r.resize.layer&&Math.abs(r.card.w-w)<=1&&Math.abs(r.card.h-h)<=2;})()
JS
fi
if open "mode=fixed"; then
check "A18 after a full reload the stored size is re-applied to the dialog" <<'JS'
(()=>{const r=__fx.rects();return !!r.storedSize&&Math.abs(r.card.w-r.storedSize.w)<=1&&Math.abs(r.card.h-r.storedSize.h)<=2;})()
JS
shot "A18-persisted-after-reload"
check "A19 BWI.modalResize.reset() → natural size (400 wide) and storage cleared" <<'JS'
(async()=>{const r=await __fx.resetSize();return Math.abs(r.card.w-400)<=1&&r.card.inlineWidth===''&&r.storedSize==null;})()
JS
tail_checks A
# Last in this page session on purpose: at the 300px minimum the header +
# search + ~300px panel already exceed the card, the list (MIN_LIST_PX) hangs
# out below it, and feature3's clipping probe may read that as "Instagram
# clips the list" → width-only for the rest of the session.
check "A20 min size WITH panel: drag nw (+800,+800) clamps width to 320; height floors at header + panel + 120px list (>= 300) and the list stays inside the card" <<'JS'
(async()=>{const d=await __fx.drag('nw',800,800,{settleMs:50});return d.after.card.w>=320&&d.after.card.w<=324&&d.after.card.h>=300&&d.after.scroll.h>=118&&d.after.scroll.bottom<=d.after.card.bottom+1;})()
JS
shot "A20-min-size-with-panel"
check "A21 …and 1.5s later it is still NOT width-only (a card floored at its own content must not count as Instagram clipping the list)" <<'JS'
(async()=>{await __fx.settle(1500);const r=__fx.rects();window.__fxMinState=__fx.state();const s=__fx.storedSize();return !r.resize.widthOnly&&!!s&&s.h===300;})()
JS
info "A21 state() at min size" <<'JS'
__fx.state()
JS
fi
fi

# ============================================================================
if wants B; then
say "==== B  centered=0 (card pinned top-left → 1x drag factor)"
if fresh "mode=fixed&centered=0"; then
check "B0 fixture: card is not centered on either axis" <<'JS'
(()=>{const v=__fx.viewportInfo();return !v.cardCenteredX&&!v.cardCenteredY;})()
JS
check "B1 drag se (+60,+40) → card +60 x +40 (1x)" <<'JS'
(async()=>{const d=await __fx.drag('se',60,40);return Math.abs(d.delta.cardW-60)<=2&&Math.abs(d.delta.cardH-40)<=2;})()
JS
check "B2 drag nw (-30,-20) → card +30 x +20 (1x)" <<'JS'
(async()=>{const d=await __fx.drag('nw',-30,-20);return Math.abs(d.delta.cardW-30)<=2&&Math.abs(d.delta.cardH-20)<=2;})()
JS
shot "B2-topleft"
tail_checks B
fi
fi

# ============================================================================
if wants C; then
say "==== C  mode=flex (list flexes with the card)"
if fresh "mode=flex"; then
check "C1 attach; list has NO inline height and still overflows" <<'JS'
(()=>{const r=__fx.rects();return r.resize.layer&&r.scroll.inlineHeight===''&&r.scroll.scrollHeight>r.scroll.clientHeight+20;})()
JS
check "C2 drag s (0,+90) → card +180; list + panel absorb all of it" <<'JS'
(async()=>{const d=await __fx.drag('s',0,90);window.__fxD=d;return Math.abs(d.delta.cardH-180)<=2&&d.delta.scrollH>0&&Math.abs(d.delta.scrollH+(d.delta.panelListH||0)-d.delta.cardH)<=3;})()
JS
check "C3 flex mode detected: feature3 left the list's height alone, state().mode == flex" <<'JS'
(()=>{const d=window.__fxD;const s=__fx.state();return d.after.scroll.inlineHeight===''&&s.available&&s.state.mode==='flex';})()
JS
check "C4 not rolled back (no bwi-resize--width-only), vertical handles visible" <<'JS'
(()=>{const r=__fx.rects();return !r.resize.widthOnly&&getComputedStyle(__fx.card.querySelector('.bwi-resize-handle--s')).display!=='none';})()
JS
shot "C2-flex-after-drag"
info "C state()" <<'JS'
__fx.state()
JS
tail_checks C
fi
fi

# ============================================================================
if wants D; then
say "==== D  mode=window (react-window symptom → rollback to width-only)"
# panel=0 so a +300 card gives the list ~656px — well past the 8-row (480px)
# band feature3 must notice is empty below.
if fresh "mode=window&panel=0"; then
check "D1 fixture: 8 rows mounted, list detected, scrollHeight = 60 rows" <<'JS'
(()=>{const r=__fx.rects();return r.resize.layer&&r.scroll.rowsMounted===8&&r.scroll.scrollHeight>=3600;})()
JS
check "D2 drag s (0,+150) → windowing detected: width-only class, card + list height rolled back (356px), no blank band" <<'JS'
(async()=>{const s=__fx.card.querySelector('.bwi-resize-handle--s');const before=__fx.rects();if(getComputedStyle(s).display==='none'){window.__fxD=null;return before.resize.widthOnly&&before.scroll.inlineHeight==='356px';}const d=await __fx.drag('s',0,150,{settleMs:1500});window.__fxD=d;return d.after.resize.widthOnly&&Math.abs(d.after.card.h-d.before.card.h)<=2&&d.after.scroll.inlineHeight==='356px'&&d.after.card.inlineHeight===''&&(d.after.scroll.coveredToBottom||d.after.scroll.emptyBandPx<=60);})()
JS
check "D3 vertical handles hidden after rollback (n s ne nw sw display:none)" <<'JS'
(()=>['n','s','ne','nw','sw'].every(d=>getComputedStyle(__fx.card.querySelector('.bwi-resize-handle--'+d)).display==='none'))()
JS
check "D4 width drag still works: e (+50,0) → +100, height unchanged" <<'JS'
(async()=>{const d=await __fx.drag('e',50,0);return Math.abs(d.delta.cardW-100)<=2&&Math.abs(d.delta.cardH)<=2;})()
JS
check "D5 stored size keeps the height but marks it hBlocked after rollback (not re-applied next load; a new vertical drag retries)" <<'JS'
(()=>{const s=__fx.storedSize();return !!s&&typeof s.w==='number'&&typeof s.h==='number'&&s.hBlocked===true;})()
JS
check "D6 reopen() → new dialog: width restored, natural height, list still 356px" <<'JS'
(async()=>{const before=__fx.rects();const r=await __fx.reopen(null,{settleMs:1500});return Math.abs(r.card.w-before.card.w)<=1&&Math.abs(r.card.h-before.card.h)<=2&&r.scroll.inlineHeight==='356px';})()
JS
shot "D-window-after-rollback"
info "D state()" <<'JS'
__fx.state()
JS
tail_checks D
fi
say "---- D' mode=window WITH the panel: never a blank band (rollback OR still covered)"
if fresh "mode=window"; then
check "D7 drag s (0,+100) with panel: width-only rollback OR the 8-row band still covers the list (empty band <= 60px)" <<'JS'
(async()=>{const s=__fx.card.querySelector('.bwi-resize-handle--s');if(getComputedStyle(s).display==='none')return __fx.rects().resize.widthOnly;const d=await __fx.drag('s',0,100,{settleMs:1500});return d.after.resize.widthOnly||d.after.scroll.coveredToBottom||d.after.scroll.emptyBandPx<=60;})()
JS
shot "D7-window-with-panel"
fi
fi

# ============================================================================
if wants E; then
say "==== E  mode=clip (ancestor clips the grown list → rollback to width-only)"
if fresh "mode=clip"; then
check "E1 fixture: clip box is 356px and the list detected" <<'JS'
(()=>{const r=__fx.rects();return r.resize.layer&&!!r.clip&&Math.abs(r.clip.h-356)<=1&&r.scroll.scrollHeight>r.scroll.clientHeight+20;})()
JS
check "E2 drag s (0,+50) → clipping detected: width-only, list back to 356px, card height back to natural" <<'JS'
(async()=>{const s=__fx.card.querySelector('.bwi-resize-handle--s');const before=__fx.rects();if(getComputedStyle(s).display==='none'){return before.resize.widthOnly&&before.scroll.inlineHeight==='356px';}const d=await __fx.drag('s',0,50,{settleMs:1500});window.__fxD=d;return d.after.resize.widthOnly&&d.after.scroll.inlineHeight==='356px'&&Math.abs(d.after.card.h-d.before.card.h)<=2;})()
JS
check "E3 list never sticks out below the clipping ancestor after rollback" <<'JS'
(()=>{const r=__fx.rects();return !!r.clip&&r.scroll.bottom<=r.clip.bottom+1;})()
JS
check "E4 width drag still works: e (+50,0) → +100 (height is Instagram's own — the wider panel note reflows, so it may change)" <<'JS'
(async()=>{const d=await __fx.drag('e',50,0);return Math.abs(d.delta.cardW-100)<=2&&d.after.card.inlineHeight==='';})()
JS
shot "E-clip-after-rollback"
info "E state()" <<'JS'
__fx.state()
JS
tail_checks E
fi
fi

# ============================================================================
if wants F; then
say "==== F  title=followers (Feature 7 panel via renderListSubsection)"
if fresh "title=followers"; then
check "F1 panel: data-bwi=unfollowers, note present, 12 rows, sits above the list" <<'JS'
(()=>{const p=__fx.panelRoot;const r=__fx.rects();return !!p&&p.dataset.bwi==='unfollowers'&&!!p.querySelector('.bwi-section__note')&&p.querySelectorAll('.bwi-row').length===12&&r.panel.aboveList;})()
JS
check "F2 toggle contract on this panel too: ▴ Hide → ▾ Show (collapsed, list hidden) → ▴ Hide" <<'JS'
(()=>{const a=__fx.toggleState();const b=__fx.clickToggle();const c=__fx.clickToggle();return a.glyph==='▴'&&a.label==='Hide'&&a.ariaExpanded==='true'&&b.glyph==='▾'&&b.label==='Show'&&b.ariaExpanded==='false'&&b.collapsed&&b.listDisplay==='none'&&c.glyph==='▴'&&c.label==='Hide'&&!c.collapsed;})()
JS
check "F3 dialog titled Followers is resizable too: drag se (+30,+20) → +60 x +40" <<'JS'
(async()=>{const d=await __fx.drag('se',30,20);return Math.abs(d.delta.cardW-60)<=2&&Math.abs(d.delta.cardH-40)<=2;})()
JS
shot "F-followers"
tail_checks F
fi
fi

# ============================================================================
if wants G; then
say "==== G  panel=0 (bare native modal)"
if fresh "panel=0"; then
check "G1 no panel: layer attaches, list detected" <<'JS'
(()=>{const r=__fx.rects();return r.resize.layer&&r.panel===null&&r.scroll.scrollHeight>r.scroll.clientHeight+20;})()
JS
check "G2 drag se (+60,+40) → +120 x +80 and the list grows by the full +80 (fixed mode, no panel share)" <<'JS'
(async()=>{const d=await __fx.drag('se',60,40);return Math.abs(d.delta.cardW-120)<=2&&Math.abs(d.delta.cardH-80)<=2&&Math.abs(d.delta.scrollH-80)<=3;})()
JS
check "G3 min size: drag nw (+800,+800) clamps to 320 x 300 and stays height-resizable (list fits: 300 - header - search >= MIN_LIST_PX)" <<'JS'
(async()=>{const d=await __fx.drag('nw',800,800,{settleMs:1500});return d.after.card.w>=320&&d.after.card.w<=324&&d.after.card.h>=300&&d.after.card.h<=304&&!d.after.resize.widthOnly&&d.after.scroll.bottom<=d.after.card.bottom+1;})()
JS
shot "G3-min-size"
check "G4 dblclick → natural 400 x 451 (header 43 + search 52 + list 356)" <<'JS'
(async()=>{const d=await __fx.dblclickHandle('nw');return Math.abs(d.after.card.w-400)<=1&&Math.abs(d.after.card.h-451)<=2;})()
JS
tail_checks G
fi
fi

# ============================================================================
run_js "__fx.resetStorage(); true" >/dev/null 2>&1
say ""
say "==== summary: $PASS passed, $FAIL failed, $SOFT soft-mismatch  (screenshots in $SHOTS)"
[ "$FAIL" -eq 0 ]
