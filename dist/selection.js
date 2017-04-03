var ref = require("prosemirror-state");
var TextSelection = ref.TextSelection;
var NodeSelection = ref.NodeSelection;

var browser = require("./browser")

// Track the state of the current editor selection. Keeps the editor
// selection in sync with the DOM selection by polling for changes,
// as there is no DOM event for DOM selection changes.
var SelectionReader = function(view) {
  var this$1 = this;

  this.view = view

  // Track the state of the DOM selection.
  this.lastAnchorNode = this.lastHeadNode = this.lastAnchorOffset = this.lastHeadOffset = null
  this.lastSelection = view.state.selection
  this.ignoreUpdates = false
  this.poller = poller(this)

  view.dom.addEventListener("focus", function () { return this$1.poller.start(); })
  view.dom.addEventListener("blur", function () { return this$1.poller.stop(); })

  if (!view.editable) { this.poller.start() }
};

SelectionReader.prototype.destroy = function () { this.poller.stop() };

SelectionReader.prototype.poll = function (origin) { this.poller.poll(origin) };

SelectionReader.prototype.editableChanged = function () {
  if (!this.view.editable) { this.poller.start() }
  else if (!this.view.hasFocus()) { this.poller.stop() }
};

// : () → bool
// Whether the DOM selection has changed from the last known state.
SelectionReader.prototype.domChanged = function () {
  var sel = this.view.root.getSelection()
  return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
    sel.focusNode != this.lastHeadNode || sel.focusOffset != this.lastHeadOffset
};

// Store the current state of the DOM selection.
SelectionReader.prototype.storeDOMState = function (selection) {
  var sel = this.view.root.getSelection()
  this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset
  this.lastHeadNode = sel.focusNode; this.lastHeadOffset = sel.focusOffset
  this.lastSelection = selection
};

SelectionReader.prototype.clearDOMState = function () {
  this.lastAnchorNode = this.lastSelection = null
};

// : (?string) → bool
// When the DOM selection changes in a notable manner, modify the
// current selection state to match.
SelectionReader.prototype.readFromDOM = function (origin) {
  if (this.ignoreUpdates || !this.domChanged() || !this.view.hasFocus()) { return }
  if (!this.view.inDOMChange) { this.view.domObserver.flush() }
  if (this.view.inDOMChange) { return }

  var domSel = this.view.root.getSelection(), doc = this.view.state.doc
  var nearestDesc = this.view.docView.nearestDesc(domSel.focusNode)
  // If the selection is in a non-document part of the view, ignore it
  if (!nearestDesc.size) {
    this.storeDOMState()
    return
  }
  var head = this.view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset)
  var $head = doc.resolve(head), $anchor, selection
  if (domSel.isCollapsed) {
    $anchor = $head
    while (nearestDesc && !nearestDesc.node) { nearestDesc = nearestDesc.parent }
    if (nearestDesc && nearestDesc.node.isAtom && NodeSelection.isSelectable(nearestDesc.node)) {
      var pos = nearestDesc.posAtStart
      selection = new NodeSelection(head == pos ? $head : doc.resolve(pos))
    }
  } else {
    $anchor = doc.resolve(this.view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset))
  }

  if (!selection) {
    var bias = origin == "pointer" ||
        (this.view.state.selection.head != null && this.view.state.selection.head < $head.pos) ? 1 : -1
    selection = selectionBetween(this.view, $anchor, $head, bias)
  }
  if (head == selection.head && $anchor.pos == selection.anchor)
    { this.storeDOMState(selection) }
  if (!this.view.state.selection.eq(selection)) {
    var tr = this.view.state.tr.setSelection(selection)
    if (origin == "pointer") { tr.setMeta("pointer", true) }
    this.view.dispatch(tr)
  }
};
exports.SelectionReader = SelectionReader

// There's two polling models. On browsers that support the
// selectionchange event (everything except Firefox, basically), we
// register a listener for that whenever the editor is focused.
var SelectionChangePoller = function(reader) {
  var this$1 = this;

  this.listening = false
  this.curOrigin = null
  this.originTime = 0
  this.reader = reader

  this.readFunc = function () { return reader.readFromDOM(this$1.originTime > Date.now() - 50 ? this$1.curOrigin : null); }
};

SelectionChangePoller.prototype.poll = function (origin) {
  this.curOrigin = origin
  this.originTime = Date.now()
};

SelectionChangePoller.prototype.start = function () {
  if (!this.listening) {
    document.addEventListener("selectionchange", this.readFunc)
    this.listening = true
    if (this.reader.view.hasFocus()) { this.readFunc() }
  }
};

SelectionChangePoller.prototype.stop = function () {
  if (this.listening) {
    document.removeEventListener("selectionchange", this.readFunc)
    this.listening = false
  }
};

// On Firefox, we use timeout-based polling.
var TimeoutPoller = function(reader) {
  // The timeout ID for the poller when active.
  this.polling = null
  this.reader = reader
  this.pollFunc = this.doPoll.bind(this, null)
};

TimeoutPoller.prototype.doPoll = function (origin) {
  var view = this.reader.view
  if (view.focused || !view.editable) {
    this.reader.readFromDOM(origin)
    this.polling = setTimeout(this.pollFunc, 100)
  } else {
    this.polling = null
  }
};

TimeoutPoller.prototype.poll = function (origin) {
  clearTimeout(this.polling)
  this.polling = setTimeout(origin ? this.doPoll.bind(this, origin) : this.pollFunc, 0)
};

TimeoutPoller.prototype.start = function () {
  if (this.polling == null) { this.poll() }
};

TimeoutPoller.prototype.stop = function () {
  clearTimeout(this.polling)
  this.polling = null
};

function poller(reader) {
  return new ("onselectionchange" in document ? SelectionChangePoller : TimeoutPoller)(reader)
}

function selectionToDOM(view, takeFocus) {
  var sel = view.state.selection
  syncNodeSelection(view, sel)

  if (!view.hasFocus()) {
    if (!takeFocus) { return }
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=921444
    else if (browser.gecko && view.editable) { view.dom.focus() }
  }

  var reader = view.selectionReader
  if (reader.lastSelection && reader.lastSelection.eq(sel) && !reader.domChanged()) { return }

  reader.ignoreUpdates = true

  if (view.cursorWrapper) {
    selectCursorWrapper(view)
  } else {
    var anchor = sel.anchor;
    var head = sel.head;
    var resetEditableFrom, resetEditableTo
    if (browser.webkit && !(sel instanceof TextSelection)) {
      if (!sel.$from.parent.inlineContent)
        { resetEditableFrom = temporarilyEditable(view, sel.from) }
      if (!sel.empty && !sel.$from.parent.inlineContent)
        { resetEditableTo = temporarilyEditable(view, sel.to) }
    }
    view.docView.setSelection(anchor, head, view.root)
    if (browser.webkit) {
      if (resetEditableFrom) { resetEditableFrom.contentEditable = "false" }
      if (resetEditableTo) { resetEditableTo.contentEditable = "false" }
    }
    if (sel.visible) {
      view.dom.classList.remove("ProseMirror-hideselection")
    } else {
      view.dom.classList.add("ProseMirror-hideselection")
      if ("onselectionchange" in document) { removeClassOnSelectionChange(view) }
    }
  }

  reader.storeDOMState(sel)
  reader.ignoreUpdates = false
}
exports.selectionToDOM = selectionToDOM

// Kludge to work around Webkit not allowing a selection to start/end
// before a non-editable block node. We briefly make it editable, set
// the selection, then set it uneditable again.
function temporarilyEditable(view, pos) {
  var desc = view.docView.descAt(pos)
  if (desc && !desc.contentDOM && desc.dom.contentEditable == "false") {
    desc.dom.contentEditable = "true"
    return desc.dom
  }
}

function removeClassOnSelectionChange(view) {
  document.removeEventListener("selectionchange", view.hideSelectionGuard)
  var domSel = view.root.getSelection()
  var node = domSel.anchorNode, offset = domSel.anchorOffset
  document.addEventListener("selectionchange", view.hideSelectionGuard = function () {
    if (domSel.anchorNode != node || domSel.anchorOffset != offset) {
      document.removeEventListener("selectionchange", view.hideSelectionGuard)
      view.dom.classList.remove("ProseMirror-hideselection")
    }
  })
}

function selectCursorWrapper(view) {
  var domSel = view.root.getSelection(), range = document.createRange()
  var node = view.cursorWrapper.type.widget
  range.setEnd(node, node.childNodes.length)
  range.collapse(false)
  domSel.removeAllRanges()
  domSel.addRange(range)
}

function syncNodeSelection(view, sel) {
  if (sel instanceof NodeSelection) {
    var desc = view.docView.descAt(sel.from)
    if (desc != view.lastSelectedViewDesc) {
      clearNodeSelection(view)
      if (desc) { desc.selectNode() }
      view.lastSelectedViewDesc = desc
    }
  } else {
    clearNodeSelection(view)
  }
}

// Clear all DOM statefulness of the last node selection.
function clearNodeSelection(view) {
  if (view.lastSelectedViewDesc) {
    view.lastSelectedViewDesc.deselectNode()
    view.lastSelectedViewDesc = null
  }
}

function selectionBetween(view, $anchor, $head, bias) {
  return view.someProp("createSelectionBetween", function (f) { return f(view, $anchor, $head); })
    || TextSelection.between($anchor, $head, bias)
}
exports.selectionBetween = selectionBetween
