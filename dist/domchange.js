var ref = require("prosemirror-model");
var Fragment = ref.Fragment;
var DOMParser = ref.DOMParser;
var ref$1 = require("prosemirror-state");
var Selection = ref$1.Selection;
var ref$2 = require("prosemirror-transform");
var Mapping = ref$2.Mapping;

var ref$3 = require("./trackmappings");
var TrackMappings = ref$3.TrackMappings;
var ref$4 = require("./selection");
var selectionBetween = ref$4.selectionBetween;

var DOMChange = function(view, composing) {
  var this$1 = this;

  this.view = view
  this.state = view.state
  this.composing = composing
  this.from = this.to = null
  this.timeout = composing ? null : setTimeout(function () { return this$1.finish(); }, 20)
  this.trackMappings = new TrackMappings(view.state)

  // If there have been changes since this DOM update started, we must
  // map our start and end positions, as well as the new selection
  // positions, through them. This tracks that mapping.
  this.mapping = new Mapping
  this.mappingTo = view.state
};

DOMChange.prototype.addRange = function (from, to) {
  if (this.from == null) {
    this.from = from
    this.to = to
  } else {
    this.from = Math.min(from, this.from)
    this.to = Math.max(to, this.to)
  }
};

DOMChange.prototype.changedRange = function () {
  if (this.from == null) { return rangeAroundSelection(this.state.selection) }
  var $from = this.state.doc.resolve(Math.min(this.from, this.state.selection.from)), $to = this.state.doc.resolve(this.to)
  var shared = $from.sharedDepth(this.to)
  return {from: $from.before(shared + 1), to: $to.after(shared + 1)}
};

DOMChange.prototype.markDirty = function (range) {
  if (this.from == null) { this.view.docView.markDirty((range = range || this.changedRange()).from, range.to) }
  else { this.view.docView.markDirty(this.from, this.to) }
};

DOMChange.prototype.stateUpdated = function (state) {
  if (this.trackMappings.getMapping(state, this.mapping)) {
    this.trackMappings.destroy()
    this.trackMappings = new TrackMappings(state)
    this.mappingTo = state
    return true
  } else {
    this.markDirty()
    this.destroy()
    return false
  }
};

DOMChange.prototype.finish = function (force) {
  clearTimeout(this.timeout)
  if (this.composing && !force) { return }
  var range = this.changedRange()
  this.markDirty(range)

  this.destroy()
  readDOMChange(this.view, this.mapping, this.state, range)

  // If the reading didn't result in a view update, force one by
  // resetting the view to its current state.
  if (this.view.docView.dirty) { this.view.updateState(this.view.state) }
};

DOMChange.prototype.destroy = function () {
  clearTimeout(this.timeout)
  this.trackMappings.destroy()
  this.view.inDOMChange = null
};

DOMChange.prototype.compositionEnd = function () {
    var this$1 = this;

  if (this.composing) {
    this.composing = false
    this.timeout = setTimeout(function () { return this$1.finish(); }, 50)
  }
};

DOMChange.start = function (view, composing) {
  if (view.inDOMChange) {
    if (composing) {
      clearTimeout(view.inDOMChange.timeout)
      view.inDOMChange.composing = true
    }
  } else {
    view.inDOMChange = new DOMChange(view, composing)
  }
  return view.inDOMChange
};
exports.DOMChange = DOMChange

// Note that all referencing and parsing is done with the
// start-of-operation selection and document, since that's the one
// that the DOM represents. If any changes came in in the meantime,
// the modification is mapped over those before it is applied, in
// readDOMChange.

function parseBetween(view, oldState, range) {
  var ref = view.docView.parseRange(range.from, range.to);
  var parent = ref.node;
  var fromOffset = ref.fromOffset;
  var toOffset = ref.toOffset;
  var from = ref.from;
  var to = ref.to;

  var domSel = view.root.getSelection(), find = null, anchor = domSel.anchorNode
  if (anchor && view.dom.contains(anchor.nodeType == 1 ? anchor : anchor.parentNode)) {
    find = [{node: anchor, offset: domSel.anchorOffset}]
    if (!domSel.isCollapsed)
      { find.push({node: domSel.focusNode, offset: domSel.focusOffset}) }
  }
  var startDoc = oldState.doc
  var parser = view.someProp("domParser") || DOMParser.fromSchema(view.state.schema)
  var $from = startDoc.resolve(from)
  var sel = null, doc = parser.parse(parent, {
    topNode: $from.parent.copy(),
    topStart: $from.index(),
    topOpen: true,
    from: fromOffset,
    to: toOffset,
    preserveWhitespace: true,
    editableContent: true,
    findPositions: find,
    ruleFromNode: ruleFromNode,
    context: $from
  })
  if (find && find[0].pos != null) {
    var anchor$1 = find[0].pos, head = find[1] && find[1].pos
    if (head == null) { head = anchor$1 }
    sel = {anchor: anchor$1 + from, head: head + from}
  }
  return {doc: doc, sel: sel, from: from, to: to}
}

function ruleFromNode(dom) {
  var desc = dom.pmViewDesc
  if (desc) { return desc.parseRule() }
  else if (dom.nodeName == "BR" && dom.parentNode && dom.parentNode.lastChild == dom) { return {ignore: true} }
}

function isAtEnd($pos, depth) {
  for (var i = depth || 0; i < $pos.depth; i++)
    { if ($pos.index(i) + 1 < $pos.node(i).childCount) { return false } }
  return $pos.parentOffset == $pos.parent.content.size
}
function isAtStart($pos, depth) {
  for (var i = depth || 0; i < $pos.depth; i++)
    { if ($pos.index(0) > 0) { return false } }
  return $pos.parentOffset == 0
}

function rangeAroundSelection(selection) {
  var $from = selection.$from;
  var $to = selection.$to;

  if ($from.sameParent($to) && $from.parent.isTextblock && $from.parentOffset && $to.parentOffset < $to.parent.content.size) {
    var startOff = Math.max(0, $from.parentOffset)
    var size = $from.parent.content.size
    var endOff = Math.min(size, $to.parentOffset)

    if (startOff > 0)
      { startOff = $from.parent.childBefore(startOff).offset }
    if (endOff < size) {
      var after = $from.parent.childAfter(endOff)
      endOff = after.offset + after.node.nodeSize
    }
    var nodeStart = $from.start()
    return {from: nodeStart + startOff, to: nodeStart + endOff}
  } else {
    for (var depth = 0;; depth++) {
      var fromStart = isAtStart($from, depth + 1), toEnd = isAtEnd($to, depth + 1)
      if (fromStart || toEnd || $from.index(depth) != $to.index(depth) || $to.node(depth).isTextblock) {
        var from = $from.before(depth + 1), to = $to.after(depth + 1)
        if (fromStart && $from.index(depth) > 0)
          { from -= $from.node(depth).child($from.index(depth) - 1).nodeSize }
        if (toEnd && $to.index(depth) + 1 < $to.node(depth).childCount)
          { to += $to.node(depth).child($to.index(depth) + 1).nodeSize }
        return {from: from, to: to}
      }
    }
  }
}

function keyEvent(keyCode, key) {
  var event = document.createEvent("Event")
  event.initEvent("keydown", true, true)
  event.keyCode = keyCode
  event.key = event.code = key
  return event
}

function readDOMChange(view, mapping, oldState, range) {
  var parse = parseBetween(view, oldState, range)

  var doc = oldState.doc, compare = doc.slice(parse.from, parse.to)
  var change = findDiff(compare.content, parse.doc.content, parse.from, oldState.selection.from)

  if (!change) {
    if (parse.sel) {
      var sel = resolveSelection(view, view.state.doc, mapping, parse.sel)
      if (sel && !sel.eq(view.state.selection)) { view.dispatch(view.state.tr.setSelection(sel)) }
    }
    return
  }

  var $from = parse.doc.resolveNoCache(change.start - parse.from)
  var $to = parse.doc.resolveNoCache(change.endB - parse.from)
  var nextSel
  // If this looks like the effect of pressing Enter, just dispatch an
  // Enter key instead.
  if (!$from.sameParent($to) && $from.pos < parse.doc.content.size &&
      (nextSel = Selection.findFrom(parse.doc.resolve($from.pos + 1), 1, true)) &&
      nextSel.head == $to.pos &&
      view.someProp("handleKeyDown", function (f) { return f(view, keyEvent(13, "Enter")); }))
    { return }
  // Same for backspace
  if (oldState.selection.anchor > change.start &&
      looksLikeJoin(doc, change.start, change.endA, $from, $to) &&
      view.someProp("handleKeyDown", function (f) { return f(view, keyEvent(8, "Backspace")); }))
    { return }

  var from = mapping.map(change.start), to = mapping.map(change.endA, -1)

  var tr, storedMarks, markChange, $from1
  if ($from.sameParent($to) && $from.parent.inlineContent) {
    if ($from.pos == $to.pos) { // Deletion
      tr = view.state.tr.delete(from, to)
      var $start = doc.resolve(change.start)
      if ($start.parentOffset < $start.parent.content.size) { storedMarks = $start.marks(true) }
    } else if ( // Adding or removing a mark
      change.endA == change.endB && ($from1 = doc.resolve(change.start)) &&
      (markChange = isMarkChange($from.parent.content.cut($from.parentOffset, $to.parentOffset),
                                 $from1.parent.content.cut($from1.parentOffset, change.endA - $from1.start())))
    ) {
      tr = view.state.tr
      if (markChange.type == "add") { tr.addMark(from, to, markChange.mark) }
      else { tr.removeMark(from, to, markChange.mark) }
    } else if ($from.parent.child($from.index()).isText && $from.index() == $to.index() - ($to.textOffset ? 0 : 1)) {
      // Both positions in the same text node -- simply insert text
      var text = $from.parent.textBetween($from.parentOffset, $to.parentOffset)
      if (view.someProp("handleTextInput", function (f) { return f(view, from, to, text); })) { return }
      tr = view.state.tr.insertText(text, from, to)
    }
  }

  if (!tr)
    { tr = view.state.tr.replace(from, to, parse.doc.slice(change.start - parse.from, change.endB - parse.from)) }
  if (parse.sel) {
    var sel$1 = resolveSelection(view, tr.doc, mapping, parse.sel)
    if (sel$1) { tr.setSelection(sel$1) }
  }
  if (storedMarks) { tr.ensureMarks(storedMarks) }
  view.dispatch(tr.scrollIntoView())
}

function resolveSelection(view, doc, mapping, parsedSel) {
  if (Math.max(parsedSel.anchor, parsedSel.head) > doc.content.size) { return null }
  return selectionBetween(view, doc.resolve(mapping.map(parsedSel.anchor)),
                          doc.resolve(mapping.map(parsedSel.head)))
}

// : (Fragment, Fragment) → ?{mark: Mark, type: string}
// Given two same-length, non-empty fragments of inline content,
// determine whether the first could be created from the second by
// removing or adding a single mark type.
function isMarkChange(cur, prev) {
  var curMarks = cur.firstChild.marks, prevMarks = prev.firstChild.marks
  var added = curMarks, removed = prevMarks, type, mark, update
  for (var i = 0; i < prevMarks.length; i++) { added = prevMarks[i].removeFromSet(added) }
  for (var i$1 = 0; i$1 < curMarks.length; i$1++) { removed = curMarks[i$1].removeFromSet(removed) }
  if (added.length == 1 && removed.length == 0) {
    mark = added[0]
    type = "add"
    update = function (node) { return node.mark(mark.addToSet(node.marks)); }
  } else if (added.length == 0 && removed.length == 1) {
    mark = removed[0]
    type = "remove"
    update = function (node) { return node.mark(mark.removeFromSet(node.marks)); }
  } else {
    return null
  }
  var updated = []
  for (var i$2 = 0; i$2 < prev.childCount; i$2++) { updated.push(update(prev.child(i$2))) }
  if (Fragment.from(updated).eq(cur)) { return {mark: mark, type: type} }
}

function looksLikeJoin(old, start, end, $newStart, $newEnd) {
  if (!$newStart.parent.isTextblock ||
      // The content must have shrunk
      end - start <= $newEnd.pos - $newStart.pos ||
      // newEnd must point directly at or after the end of the block that newStart points into
      skipClosingAndOpening($newStart, true, false) < $newEnd.pos)
    { return false }

  var $start = old.resolve(start)
  // Start must be at the end of a block
  if ($start.parentOffset < $start.parent.content.size || !$start.parent.isTextblock)
    { return false }
  var $next = old.resolve(skipClosingAndOpening($start, true, true))
  // The next textblock must start before end and end near it
  if (!$next.parent.isTextblock || $next.pos > end ||
      skipClosingAndOpening($next, true, false) < end)
    { return false }

  // The fragments after the join point must match
  return $newStart.parent.content.cut($newStart.parentOffset).eq($next.parent.content)
}

function skipClosingAndOpening($pos, fromEnd, mayOpen) {
  var depth = $pos.depth, end = fromEnd ? $pos.end() : $pos.pos
  while (depth > 0 && (fromEnd || $pos.indexAfter(depth) == $pos.node(depth).childCount)) {
    depth--
    end++
    fromEnd = false
  }
  if (mayOpen) {
    var next = $pos.node(depth).maybeChild($pos.indexAfter(depth))
    while (next && !next.isLeaf) {
      next = next.firstChild
      end++
    }
  }
  return end
}

function findDiff(a, b, pos, preferedStart) {
  var start = a.findDiffStart(b, pos)
  if (start == null) { return null }
  var ref = a.findDiffEnd(b, pos + a.size, pos + b.size);
  var endA = ref.a;
  var endB = ref.b;
  if (endA < start && a.size < b.size) {
    var move = preferedStart <= start && preferedStart >= endA ? start - preferedStart : 0
    start -= move
    endB = start + (endB - endA)
    endA = start
  } else if (endB < start) {
    var move$1 = preferedStart <= start && preferedStart >= endB ? start - preferedStart : 0
    start -= move$1
    endA = start + (endA - endB)
    endB = start
  }
  return {start: start, endA: endA, endB: endB}
}
