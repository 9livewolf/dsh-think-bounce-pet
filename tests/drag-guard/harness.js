/* Assertions for the macOS window-drag contract of lib/client.js.
 *
 * Runs the real plugin bundle in a page that replicates DSH's darwin app-region
 * rules (see index.html), watches the ball while it roams, and checks:
 *   1. the floating layer generates no layout box (display: contents);
 *   2. every chrome-row point outside the ball stays draggable — the original
 *      full-window layer would subtract the whole row;
 *   3. the ball carries `-webkit-app-region: no-drag` exactly while it overlaps
 *      a `[data-window-drag]` row (so clicks on the ball are not window drags);
 *   4. once the rows stop being drag rows the mark is withdrawn and the recall
 *      attribute is cleared (no stuck no-drag over the window);
 *   5. the fixed-positioned ball's box center matches its transform, i.e. the
 *      display:contents/fixed rewrite did not shift the pet.
 */
(function () {
  "use strict";

  var VIOLATIONS = [];
  var COMPOSITION_FAILS = [];
  var RECOVERY_FAILS = [];
  var BALL_SEEN = 0;
  var MARKED_SAMPLES = 0;
  var UNMARKED_OVERLAP = 0;
  var BALL_CENTER_DIFF_MAX = 0;
  var LAYER_DISPLAY = "";
  var BX = [];
  var BY = [];
  var STRIPPED = false;
  var RECOVERY_STARTED = false;

  var INTERACTIVE = "button,a,input,select,textarea,summary,[contenteditable='true'],[tabindex],[role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox'],[role='tooltip'],[role='button'],[role='link'],[role='tab'],[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio'],[role='option'],[role='checkbox'],[role='radio'],[role='switch'],[role='slider'],[role='combobox'],[role='textbox']";

  function dragRows() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-window-drag]"));
  }

  function hasBox(el) {
    var style = getComputedStyle(el);
    if (style.display === "none" || style.display === "contents") return false;
    if (el.getClientRects().length === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** The app-region an element declares through the cascade the test page reproduces. */
  function declaredRegion(el) {
    var inline = el.style.getPropertyValue("-webkit-app-region");
    if (inline !== "") return inline;
    if (el.matches("[data-window-drag]")) return "drag";
    if (el.matches("[data-window-drag-recall]")) return "no-drag";
    if (el.matches(INTERACTIVE)) return "no-drag";
    if (el.parentElement === document.body && el.id !== "root") return "no-drag";
    return "";
  }

  function collectBoxes() {
    var boxes = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      var region = declaredRegion(el);
      if (region === "" || !hasBox(el)) continue;
      var rect = el.getBoundingClientRect();
      boxes.push({ el: el, draggable: region === "drag", x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    }
    return boxes;
  }

  function draggableAt(boxes, x, y) {
    var result = false;
    for (var i = 0; i < boxes.length; i += 1) {
      var box = boxes[i];
      if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) result = box.draggable;
    }
    return result;
  }

  function overlaps(a, b) {
    return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  }

  function transformOf(ball) {
    var match = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(ball.style.transform || "");
    return match === null ? null : { x: Number(match[1]), y: Number(match[2]) };
  }

  function checkComposition(ballRect) {
    var rows = dragRows();
    var boxes = collectBoxes();
    for (var index = 0; index < rows.length; index += 1) {
      var rowRect = rows[index].getBoundingClientRect();
      var y = rowRect.top + rowRect.height / 2;
      var tested = 0;
      var blocked = 0;
      for (var x = rowRect.left + 20; x < rowRect.right - 20; x += 40) {
        if (x >= ballRect.left - 2 && x <= ballRect.right + 2) continue; // the ball owns its own box
        tested += 1;
        if (!draggableAt(boxes, x, y)) blocked += 1;
      }
      if (tested > 0 && blocked > 0) {
        COMPOSITION_FAILS.push(blocked + "/" + tested + " chrome points blocked ("
          + boxes.map(function (box) {
            return (box.el.className || box.el.tagName) + (box.draggable ? ":drag" : ":no-drag");
          }).join(" | ") + ")");
        return;
      }
    }
  }

  function sample() {
    var layer = document.querySelector(".dsh-tbp-layer");
    var ball = document.querySelector(".dsh-tbp-ball");
    LAYER_DISPLAY = layer === null ? "(no layer)" : getComputedStyle(layer).display;
    if (layer !== null && LAYER_DISPLAY !== "contents") {
      VIOLATIONS.push("layer display is " + LAYER_DISPLAY + ", expected contents");
    }
    if (ball === null) return;
    BALL_SEEN += 1;

    var ballRect = ball.getBoundingClientRect();
    BX.push((ballRect.left + ballRect.right) / 2);
    BY.push((ballRect.top + ballRect.bottom) / 2);
    var marked = ball.style.getPropertyValue("-webkit-app-region") === "no-drag";
    if (marked) MARKED_SAMPLES += 1;

    var rows = dragRows();
    var overlapping = false;
    for (var i = 0; i < rows.length; i += 1) {
      if (overlaps(ballRect, rows[i].getBoundingClientRect())) { overlapping = true; break; }
    }

    if (!STRIPPED) {
      if (marked && !overlapping) VIOLATIONS.push("ball marked no-drag while outside every drag row");
      if (!marked && overlapping) UNMARKED_OVERLAP += 1;
      var transform = transformOf(ball);
      if (transform !== null) {
        var centerX = (ballRect.left + ballRect.right) / 2;
        var centerY = (ballRect.top + ballRect.bottom) / 2;
        var diff = Math.max(Math.abs(centerX - transform.x), Math.abs(centerY - transform.y));
        if (diff > BALL_CENTER_DIFF_MAX) BALL_CENTER_DIFF_MAX = diff;
      }
      checkComposition(ballRect);
    } else if (RECOVERY_STARTED) {
      if (marked) RECOVERY_FAILS.push("ball still marked after its drag row lost the mark");
      if (document.body.hasAttribute("data-window-drag-recall")) RECOVERY_FAILS.push("recall attribute still set after unmark");
    }
  }

  function stripRows() {
    STRIPPED = true;
    var rows = document.querySelectorAll("[data-window-drag]");
    for (var i = 0; i < rows.length; i += 1) rows[i].removeAttribute("data-window-drag");
    setTimeout(function () { RECOVERY_STARTED = true; }, 300);
  }

  function finish() {
    var movedX = Math.max.apply(null, BX) - Math.min.apply(null, BX);
    var movedY = Math.max.apply(null, BY) - Math.min.apply(null, BY);
    var pass = true;
    if (BALL_SEEN === 0) { VIOLATIONS.push("ball never appeared"); pass = false; }
    if (VIOLATIONS.length > 0) pass = false;
    if (COMPOSITION_FAILS.length > 0) pass = false;
    if (RECOVERY_FAILS.length > 0) pass = false;
    if (UNMARKED_OVERLAP > 2) { VIOLATIONS.push("overlap was not guarded on " + UNMARKED_OVERLAP + " samples"); pass = false; }
    if (MARKED_SAMPLES === 0) { VIOLATIONS.push("ball was never marked while overlapping a drag row"); pass = false; }
    if (BALL_CENTER_DIFF_MAX > 1.5) { VIOLATIONS.push("ball center off by " + BALL_CENTER_DIFF_MAX.toFixed(2) + "px"); pass = false; }
    if (Math.max(movedX, movedY) < 200) { VIOLATIONS.push("ball barely moved (" + Math.round(movedX) + "x" + Math.round(movedY) + "px)"); pass = false; }
    return {
      pass: pass,
      samples: BALL_SEEN,
      markedSamples: MARKED_SAMPLES,
      unmarkedOverlapSamples: UNMARKED_OVERLAP,
      ballCenterDiffMax: Number(BALL_CENTER_DIFF_MAX.toFixed(3)),
      ballRange: [Math.round(movedX), Math.round(movedY)],
      layerDisplay: LAYER_DISPLAY,
      violations: VIOLATIONS.slice(0, 6),
      compositionFailures: COMPOSITION_FAILS.slice(0, 4),
      recoveryFails: RECOVERY_FAILS.slice(0, 4)
    };
  }

  window.__runDragTest = function () {
    return new Promise(function (resolve) {
      var timer = setInterval(function () {
        try { sample(); } catch (error) { VIOLATIONS.push("sample error: " + error); }
      }, 20);
      setTimeout(stripRows, 3600);
      setTimeout(function () {
        clearInterval(timer);
        var result = finish();
        document.getElementById("result").textContent = JSON.stringify(result);
        resolve(result);
      }, 5200);
    });
  };
})();
