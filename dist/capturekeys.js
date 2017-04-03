var ref = require("prosemirror-state");
var Selection = ref.Selection;
var NodeSelection = ref.NodeSelection;
var TextSelection = ref.TextSelection;
var browser = require("./browser")
var ref$1 = require("./dom");
var domIndex = ref$1.domIndex;

function moveSelectionBlock(state, dir) {
  var ref = state.selection;
  var $anchor = ref.$anchor;
  var $head = ref.$head;
  var $side = dir > 0 ? $anchor.max($head) : $anchor.min($head)
  var $start = !$side.parent.inlineContent ? $side : $side.depth ? state.doc.resolve(dir > 0 ? $side.after() : $side.before()) : null
  return $start && Selection.findFrom($start, dir)
}

function apply(view, sel) {
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
  return true
}

function selectHorizontally(view, dir) {
  var sel = view.state.selection
  if (sel instanceof TextSelection) {
    if (!sel.empty) {
      return false
    } else if (view.endOfTextblock(dir > 0 ? "right" : "left")) {
      var next = moveSelectionBlock(view.state, dir)
      if (next && (next instanceof NodeSelection)) { return apply(view, next) }
      return false
    } else {
      var $head = sel.$head, node = $head.textOffset ? null : dir < 0 ? $head.nodeBefore : $head.nodeAfter
      if (node && NodeSelection.isSelectable(node))
        { return apply(view, new NodeSelection(dir < 0 ? view.state.doc.resolve($head.pos - node.nodeSize) : $head)) }
      return false
    }
  } else if (sel instanceof NodeSelection && sel.node.isInline) {
    return apply(view, new TextSelection(dir > 0 ? sel.$to : sel.$from))
  } else {
    var next$1 = moveSelectionBlock(view.state, dir)
    if (next$1) { return apply(view, next$1) }
    return false
  }
}

function nodeLen(node) {
  return node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length
}

function isIgnorable(dom) {
  var desc = dom.pmViewDesc
  return desc && desc.size == 0
}

// Make sure the cursor isn't directly after one or more ignored
// nodes, which will confuse the browser's cursor motion logic.
function skipIgnoredNodesLeft(view) {
  var sel = view.root.getSelection()
  var node = sel.anchorNode, offset = sel.anchorOffset
  var moveNode, moveOffset
  for (;;) {
    if (offset > 0) {
      if (node.nodeType != 1) {
        if (node.nodeType == 3 && node.nodeValue.charAt(offset - 1) == "\ufeff") {
          moveNode = node
          moveOffset = --offset
        } else { break }
      } else {
        var before = node.childNodes[offset - 1]
        if (isIgnorable(before)) {
          moveNode = node
          moveOffset = --offset
        } else if (before.nodeType == 3) {
          node = before
          offset = node.nodeValue.length
        } else { break }
      }
    } else if (isBlockNode(node)) {
      break
    } else {
      var prev = node.previousSibling
      while (prev && isIgnorable(prev)) {
        moveNode = node.parentNode
        moveOffset = domIndex(prev)
        prev = prev.previousSibling
      }
      if (!prev) {
        node = node.parentNode
        if (node == view.dom) { break }
        offset = 0
      } else {
        node = prev
        offset = nodeLen(node)
      }
    }
  }
  if (moveNode) { setSel(sel, moveNode, moveOffset) }
}

// Make sure the cursor isn't directly before one or more ignored
// nodes.
function skipIgnoredNodesRight(view) {
  var sel = view.root.getSelection()
  var node = sel.anchorNode, offset = sel.anchorOffset, len = nodeLen(node)
  var moveNode, moveOffset
  for (;;) {
    if (offset < len) {
      if (node.nodeType != 1) { break }
      var after = node.childNodes[offset]
      if (isIgnorable(after)) {
        moveNode = node
        moveOffset = ++offset
      }
      else { break }
    } else if (isBlockNode(node)) {
      break
    } else {
      var next = node.nextSibling
      while (next && isIgnorable(next)) {
        moveNode = next.parentNode
        moveOffset = domIndex(next) + 1
        next = next.nextSibling
      }
      if (!next) {
        node = node.parentNode
        if (node == view.dom) { break }
        offset = len = 0
      } else {
        node = next
        offset = 0
        len = nodeLen(node)
      }
    }
  }
  if (moveNode) { setSel(sel, moveNode, moveOffset) }
}

function isBlockNode(dom) {
  var desc = dom.pmViewDesc
  return desc && desc.node && desc.node.isBlock
}

function setSel(sel, node, offset) {
  var range = document.createRange()
  range.setEnd(node, offset)
  range.setStart(node, offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

// : (EditorState, number)
// Check whether vertical selection motion would involve node
// selections. If so, apply it (if not, the result is left to the
// browser)
function selectVertically(view, dir) {
  var sel = view.state.selection
  if (sel instanceof TextSelection && !sel.empty) { return false }
  var $from = sel.$from;
  var $to = sel.$to;

  if (!$from.parent.inlineContent || view.endOfTextblock(dir < 0 ? "up" : "down")) {
    var next = moveSelectionBlock(view.state, dir)
    if (next && (next instanceof NodeSelection))
      { return apply(view, next) }
  }
  if (!$from.parent.inlineContent) {
    var beyond = Selection.findFrom(dir < 0 ? $from : $to, dir)
    return beyond ? apply(view, beyond) : true
  }
  return false
}

function stopNativeHorizontalDelete(view, dir) {
  if (!(view.state.selection instanceof TextSelection)) { return true }
  var ref = view.state.selection;
  var $head = ref.$head;
  var $anchor = ref.$anchor;
  var empty = ref.empty;
  if (!$head.sameParent($anchor)) { return true }
  if (!empty) { return false }
  if (view.endOfTextblock(dir > 0 ? "forward" : "backward")) { return true }
  var nextNode = !$head.textOffset && (dir < 0 ? $head.nodeBefore : $head.nodeAfter)
  if (nextNode && !nextNode.isText) {
    var tr = view.state.tr
    if (dir < 0) { tr.delete($head.pos - nextNode.nodeSize, $head.pos) }
    else { tr.delete($head.pos, $head.pos + nextNode.nodeSize) }
    view.dispatch(tr)
    return true
  }
  return false
}

// A backdrop key mapping used to make sure we always suppress keys
// that have a dangerous default effect, even if the commands they are
// bound to return false, and to make sure that cursor-motion keys
// find a cursor (as opposed to a node selection) when pressed. For
// cursor-motion keys, the code in the handlers also takes care of
// block selections.

function getMods(event) {
  var result = ""
  if (event.ctrlKey) { result += "c" }
  if (event.metaKey) { result += "m" }
  if (event.altKey) { result += "a" }
  if (event.shiftKey) { result += "s" }
  return result
}

function captureKeyDown(view, event) {
  var code = event.keyCode, mods = getMods(event)
  if (code == 8) { // Backspace
    return stopNativeHorizontalDelete(view, -1) || skipIgnoredNodesLeft(view)
  } else if (code == 46) { // Delete
    return stopNativeHorizontalDelete(view, 1) || skipIgnoredNodesRight(view)
  } else if (code == 13 || code == 27) { // Enter, Esc
    return true
  } else if (code == 37) { // Left arrow
    return selectHorizontally(view, -1) || skipIgnoredNodesLeft(view)
  } else if (code == 39) { // Right arrow
    return selectHorizontally(view, 1) || skipIgnoredNodesRight(view)
  } else if (code == 38) { // Up arrow
    return selectVertically(view, -1)
  } else if (code == 40) { // Down arrow
    return selectVertically(view, 1)
  } else if (mods == (browser.mac ? "m" : "c") &&
             (code == 66 || code == 73 || code == 89 || code == 90)) { // Mod-[biyz]
    return true
  } else if (browser.mac && // Ctrl-[dh] and Alt-d on Mac
             ((code == 68 || code == 72) && mods == "c") ||
              (code == 68 && mods == "a")) {
    return stopNativeHorizontalDelete(view, code == 68 ? 1 : -1) || skipIgnoredNodesRight(view)
  }
  return false
}
exports.captureKeyDown = captureKeyDown
