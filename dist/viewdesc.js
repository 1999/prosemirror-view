var ref = require("prosemirror-model");
var DOMSerializer = ref.DOMSerializer;
var Fragment = ref.Fragment;

var ref$1 = require("./dom");
var domIndex = ref$1.domIndex;
var isEquivalentPosition = ref$1.isEquivalentPosition;
var browser = require("./browser")

// NodeView:: interface
//
// By default, document nodes are rendered using the result of the
// [`toDOM`](#view.NodeSpec.toDOM) method of their spec, and managed
// entirely by the editor. For some use cases, such as embedded
// node-specific editing interfaces, when you need more control over
// the behavior of a node's in-editor representation, and can
// [define](#view.EditorProps.nodeViews) a custom node view.
//
//   dom:: ?dom.Node
//   The outer DOM node that represents the document node. When not
//   given, the default strategy is used to create a DOM node.
//
//   contentDOM:: ?dom.Node
//   The DOM node that should hold the node's content. Only meaningful
//   if the node view also defines a `dom` property and if its node
//   type is not a leaf node type. When this is present, ProseMirror
//   will take care of rendering the node's children into it. When it
//   is not present, the node view itself is responsible for rendering
//   (or deciding not to render) its child nodes.
//
//   update:: ?(node: Node, decorations: [Decoration]) → bool
//   When given, this will be called when the view is updating itself.
//   It will be given a node (possibly of a different type), and an
//   array of active decorations (which are automatically drawn, and
//   the node view may ignore if it isn't interested in them), and
//   should return true if it was able to update to that node, and
//   false otherwise. If the node view has a `contentDOM` property (or
//   no `dom` property), updating its child nodes will be handled by
//   ProseMirror.
//
//   selectNode:: ?()
//   Can be used to override the way the node's selected status (as a
//   node selection) is displayed.
//
//   deselectNode:: ?()
//   When defining a `selectNode` method, you should also provide a
//   `deselectNode` method to disable it again.
//
//   setSelection:: ?(anchor: number, head: number, root: dom.Document)
//   This will be called to handle setting the selection inside the
//   node. By default, a DOM selection will be created between the DOM
//   positions corresponding to the given anchor and head positions,
//   but if you override it you can do something else.
//
//   stopEvent:: ?(event: dom.Event) → bool
//   Can be used to prevent the editor view from trying to handle some
//   or all DOM events that bubble up from the node view.
//
//   ignoreMutation:: ?(dom.MutationRecord) → bool
//   Called when a DOM
//   [mutation](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
//   happens within the view. Return false if the editor should
//   re-parse the range around the mutation, true if it can safely be
//   ignored.
//
//   destroy:: ?()
//   Called when the node view is removed from the editor or the whole
//   editor is detached.

// View descriptions are data structures that describe the DOM that is
// used to represent the editor's content. They are used for:
//
// - Incremental redrawing when the document changes
//
// - Figuring out what part of the document a given DOM position
//   corresponds to
//
// - Wiring in custom implementations of the editing interface for a
//   given node
//
// They form a doubly-linked mutable tree, starting at `view.docView`.

var NOT_DIRTY = 0, CHILD_DIRTY = 1, CONTENT_DIRTY = 2, NODE_DIRTY = 3

// Superclass for the various kinds of descriptions. Defines their
// basic structure and shared methods.
var ViewDesc = function(parent, children, dom, contentDOM) {
  this.parent = parent
  this.children = children
  this.dom = dom
  // An expando property on the DOM node provides a link back to its
  // description.
  dom.pmViewDesc = this
  // This is the node that holds the child views. It may be null for
  // descs that don't have children.
  this.contentDOM = contentDOM
  this.dirty = NOT_DIRTY
};

var prototypeAccessors = { size: {},border: {},posBefore: {},posAtStart: {},posAfter: {},posAtEnd: {},contentLost: {} };

// Used to check whether a given description corresponds to a
// widget/mark/node.
ViewDesc.prototype.matchesWidget = function () { return false };
ViewDesc.prototype.matchesMark = function () { return false };
ViewDesc.prototype.matchesNode = function () { return false };
ViewDesc.prototype.matchesHack = function () { return false };

// : () → ?ParseRule
// When parsing in-editor content (in domchange.js), we allow
// descriptions to determine the parse rules that should be used to
// parse them.
ViewDesc.prototype.parseRule = function () { return null };

// : (dom.Event) → bool
// Used by the editor's event handler to ignore events that come
// from certain descs.
ViewDesc.prototype.stopEvent = function () { return false };

// The size of the content represented by this desc.
prototypeAccessors.size.get = function () {
    var this$1 = this;

  var size = 0
  for (var i = 0; i < this.children.length; i++) { size += this$1.children[i].size }
  return size
};

// For block nodes, this represents the space taken up by their
// start/end tokens.
prototypeAccessors.border.get = function () { return 0 };

ViewDesc.prototype.destroy = function () {
    var this$1 = this;

  this.parent = null
  if (this.dom.pmViewDesc == this) { this.dom.pmViewDesc = null }
  for (var i = 0; i < this.children.length; i++)
    { this$1.children[i].destroy() }
};

ViewDesc.prototype.posBeforeChild = function (child) {
    var this$1 = this;

  for (var i = 0, pos = this.posAtStart; i < this.children.length; i++) {
    var cur = this$1.children[i]
    if (cur == child) { return pos }
    pos += cur.size
  }
};

prototypeAccessors.posBefore.get = function () {
  return this.parent.posBeforeChild(this)
};

prototypeAccessors.posAtStart.get = function () {
  return this.parent ? this.parent.posBeforeChild(this) + this.border : 0
};

prototypeAccessors.posAfter.get = function () {
  return this.posBefore + this.size
};

prototypeAccessors.posAtEnd.get = function () {
  return this.posAtStart + this.size - 2 * this.border
};

// : (dom.Node, number, ?number) → number
ViewDesc.prototype.localPosFromDOM = function (dom, offset, bias) {
    var this$1 = this;

  // If the DOM position is in the content, use the child desc after
  // it to figure out a position.
  if (this.contentDOM && this.contentDOM.contains(dom.nodeType == 1 ? dom : dom.parentNode)) {
    if (bias < 0) {
      var domBefore, desc
      if (dom == this.contentDOM) {
        domBefore = dom.childNodes[offset - 1]
      } else {
        while (dom.parentNode != this.contentDOM) { dom = dom.parentNode }
        domBefore = dom.previousSibling
      }
      while (domBefore && !((desc = domBefore.pmViewDesc) && desc.parent == this)) { domBefore = domBefore.previousSibling }
      return domBefore ? this.posBeforeChild(desc) + desc.size : this.posAtStart
    } else {
      var domAfter, desc$1
      if (dom == this.contentDOM) {
        domAfter = dom.childNodes[offset]
      } else {
        while (dom.parentNode != this.contentDOM) { dom = dom.parentNode }
        domAfter = dom.nextSibling
      }
      while (domAfter && !((desc$1 = domAfter.pmViewDesc) && desc$1.parent == this)) { domAfter = domAfter.nextSibling }
      return domAfter ? this.posBeforeChild(desc$1) : this.posAtEnd
    }
  }
  // Otherwise, use various heuristics, falling back on the bias
  // parameter, to determine whether to return the position at the
  // start or at the end of this view desc.
  var atEnd
  if (this.contentDOM && this.contentDOM != this.dom && this.dom.contains(this.contentDOM)) {
    atEnd = dom.compareDocumentPosition(this.contentDOM) & 2
  } else if (this.dom.firstChild) {
    if (offset == 0) { for (var search = dom;; search = search.parentNode) {
      if (search == this$1.dom) { atEnd = false; break }
      if (search.parentNode.firstChild != search) { break }
    } }
    if (atEnd == null && offset == dom.childNodes.length) { for (var search$1 = dom;; search$1 = search$1.parentNode) {
      if (search$1 == this$1.dom) { atEnd = true; break }
      if (search$1.parentNode.lastChild != search$1) { break }
    } }
  }
  return (atEnd == null ? bias > 0 : atEnd) ? this.posAtEnd : this.posAtStart
};

// Scan up the dom finding the first desc that is a descendant of
// this one.
ViewDesc.prototype.nearestDesc = function (dom, onlyNodes) {
    var this$1 = this;

  for (var first = true, cur = dom; cur; cur = cur.parentNode) {
    var desc = this$1.getDesc(cur)
    if (desc && (!onlyNodes || desc.node)) {
      // If dom is outside of this desc's nodeDOM, don't count it.
      if (first && desc.nodeDOM && !(desc.nodeDOM.nodeType == 1 ? desc.nodeDOM.contains(dom) : desc.nodeDOM == dom)) { first = false }
      else { return desc }
    }
  }
};

ViewDesc.prototype.getDesc = function (dom) {
    var this$1 = this;

  var desc = dom.pmViewDesc
  for (var cur = desc; cur; cur = cur.parent) { if (cur == this$1) { return desc } }
};

ViewDesc.prototype.posFromDOM = function (dom, offset, bias) {
    var this$1 = this;

  for (var scan = dom;; scan = scan.parentNode) {
    var desc = this$1.getDesc(scan)
    if (desc) { return desc.localPosFromDOM(dom, offset, bias) }
  }
};

// : (number) → ?NodeViewDesc
// Find the desc for the node after the given pos, if any. (When a
// parent node overrode rendering, there might not be one.)
ViewDesc.prototype.descAt = function (pos) {
    var this$1 = this;

  for (var i = 0, offset = 0; i < this.children.length; i++) {
    var child = this$1.children[i], end = offset + child.size
    if (offset == pos && end != offset) {
      while (!child.border && child.children.length) { child = child.children[0] }
      return child
    }
    if (pos < end) { return child.descAt(pos - offset - child.border) }
    offset = end
  }
};

// : (number) → {node: dom.Node, offset: number}
ViewDesc.prototype.domFromPos = function (pos) {
    var this$1 = this;

  if (!this.contentDOM) { return {node: this.dom, offset: 0} }
  for (var offset = 0, i = 0;; i++) {
    if (offset == pos)
      { return {node: this$1.contentDOM, offset: i} }
    if (i == this$1.children.length) { throw new Error("Invalid position " + pos) }
    var child = this$1.children[i], end = offset + child.size
    if (pos < end) { return child.domFromPos(pos - offset - child.border) }
    offset = end
  }
};

// Used to find a DOM range in a single parent for a given changed
// range.
ViewDesc.prototype.parseRange = function (from, to, base) {
    var this$1 = this;
    if ( base === void 0 ) base = 0;

  var fromOffset = -1, toOffset = -1
  for (var offset = 0, i = 0;; i++) {
    var child = this$1.children[i], end = offset + child.size
    if (fromOffset == -1 && from <= end) {
      var childBase = offset + child.border
      // FIXME maybe descend mark views to parse a narrower range?
      if (from >= childBase && to <= end - child.border && child.node &&
          child.contentDOM && this$1.contentDOM.contains(child.contentDOM))
        { return child.parseRange(from - childBase, to - childBase, base + childBase) }

      from = base + offset
      for (var j = i; j > 0; j--) {
        var prev = this$1.children[j - 1]
        if (prev.size && prev.dom.parentNode == this$1.contentDOM && !prev.emptyChildAt(1)) {
          fromOffset = domIndex(prev.dom) + 1
          break
        }
        from -= prev.size
      }
      if (fromOffset == -1) { fromOffset = 0 }
    }
    if (fromOffset > -1 && to <= end) {
      to = base + end
      for (var j$1 = i + 1; j$1 < this.children.length; j$1++) {
        var next = this$1.children[j$1]
        if (next.size && next.dom.parentNode == this$1.contentDOM && !next.emptyChildAt(-1)) {
          toOffset = domIndex(next.dom)
          break
        }
        to += next.size
      }
      if (toOffset == -1) { toOffset = this$1.contentDOM.childNodes.length }
      break
    }
    offset = end
  }
  return {node: this.contentDOM, from: from, to: to, fromOffset: fromOffset, toOffset: toOffset}
};

ViewDesc.prototype.emptyChildAt = function (side) {
  if (this.border || !this.contentDOM || !this.children.length) { return false }
  var child = this.children[side < 0 ? 0 : this.children.length - 1]
  return child.size == 0 || child.emptyChildAt(side)
};

// : (number) → dom.Node
ViewDesc.prototype.domAfterPos = function (pos) {
  var ref = this.domFromPos(pos);
    var node = ref.node;
    var offset = ref.offset;
  if (node.nodeType != 1 || offset == node.childNodes.length)
    { throw new RangeError("No node after pos " + pos) }
  return node.childNodes[offset]
};

// : (number, number, dom.Document)
// View descs are responsible for setting any selection that falls
// entirely inside of them, so that custom implementations can do
// custom things with the selection. Note that this falls apart when
// a selection starts in such a node and ends in another, in which
// case we just use whatever domFromPos produces as a best effort.
ViewDesc.prototype.setSelection = function (anchor, head, root) {
    var this$1 = this;

  // If the selection falls entirely in a child, give it to that child
  var from = Math.min(anchor, head), to = Math.max(anchor, head)
  for (var i = 0, offset = 0; i < this.children.length; i++) {
    var child = this$1.children[i], end = offset + child.size
    if (from > offset && to < end)
      { return child.setSelection(anchor - offset - child.border, head - offset - child.border, root) }
    offset = end
  }

  var anchorDOM = this.domFromPos(anchor), headDOM = this.domFromPos(head)
  var domSel = root.getSelection(), range = document.createRange()
  if (isEquivalentPosition(anchorDOM.node, anchorDOM.offset, domSel.anchorNode, domSel.anchorOffset) &&
      isEquivalentPosition(headDOM.node, headDOM.offset, domSel.focusNode, domSel.focusOffset))
    { return }

  // Selection.extend can be used to create an 'inverted' selection
  // (one where the focus is before the anchor), but not all
  // browsers support it yet.
  if (domSel.extend) {
    range.setEnd(anchorDOM.node, anchorDOM.offset)
    range.collapse(false)
  } else {
    if (anchor > head) { var tmp = anchorDOM; anchorDOM = headDOM; headDOM = tmp }
    range.setEnd(headDOM.node, headDOM.offset)
    range.setStart(anchorDOM.node, anchorDOM.offset)
  }
  domSel.removeAllRanges()
  domSel.addRange(range)
  if (domSel.extend)
    { domSel.extend(headDOM.node, headDOM.offset) }
};

// : (dom.MutationRecord) → bool
ViewDesc.prototype.ignoreMutation = function (_mutation) {
  return !this.contentDOM
};

prototypeAccessors.contentLost.get = function () {
  return this.contentDOM && this.contentDOM != this.dom && !this.dom.contains(this.contentDOM)
};

// Remove a subtree of the element tree that has been touched
// by a DOM change, so that the next update will redraw it.
ViewDesc.prototype.markDirty = function (from, to) {
    var this$1 = this;

  for (var offset = 0, i = 0; i < this.children.length; i++) {
    var child = this$1.children[i], end = offset + child.size
    if (offset == end ? from <= end && to >= offset : from < end && to > offset) {
      var startInside = offset + child.border, endInside = end - child.border
      if (from >= startInside && to <= endInside) {
        this$1.dirty = from == offset || to == end ? CONTENT_DIRTY : CHILD_DIRTY
        if (from == startInside && to == endInside && child.contentLost) { child.dirty = NODE_DIRTY }
        else { child.markDirty(from - startInside, to - startInside) }
        return
      } else {
        child.dirty = NODE_DIRTY
      }
    }
    offset = end
  }
  this.dirty = CONTENT_DIRTY
};

Object.defineProperties( ViewDesc.prototype, prototypeAccessors );

// Reused array to avoid allocating fresh arrays for things that will
// stay empty anyway.
var nothing = []

// A widget desc represents a widget decoration, which is a DOM node
// drawn between the document nodes.
var WidgetViewDesc = (function (ViewDesc) {
  function WidgetViewDesc(parent, widget) {
    ViewDesc.call(this, parent, nothing, widget.type.widget, null)
    this.widget = widget
  }

  if ( ViewDesc ) WidgetViewDesc.__proto__ = ViewDesc;
  WidgetViewDesc.prototype = Object.create( ViewDesc && ViewDesc.prototype );
  WidgetViewDesc.prototype.constructor = WidgetViewDesc;

  WidgetViewDesc.prototype.matchesWidget = function (widget) {
    return this.dirty == NOT_DIRTY && widget.type.eq(this.widget.type)
  };

  WidgetViewDesc.prototype.parseRule = function () { return {ignore: true} };

  WidgetViewDesc.prototype.stopEvent = function (event) {
    var stop = this.widget.spec.stopEvent
    return stop ? stop(event) : false
  };

  return WidgetViewDesc;
}(ViewDesc));

// A cursor wrapper is used to put the cursor in when newly typed text
// needs to be styled differently from its surrounding text (for
// example through storedMarks), so that the style of the text doesn't
// visually 'pop' between typing it and actually updating the view.
var CursorWrapperDesc = (function (WidgetViewDesc) {
  function CursorWrapperDesc () {
    WidgetViewDesc.apply(this, arguments);
  }

  if ( WidgetViewDesc ) CursorWrapperDesc.__proto__ = WidgetViewDesc;
  CursorWrapperDesc.prototype = Object.create( WidgetViewDesc && WidgetViewDesc.prototype );
  CursorWrapperDesc.prototype.constructor = CursorWrapperDesc;

  CursorWrapperDesc.prototype.parseRule = function () {
    var content
    for (var child = this.dom.firstChild; child; child = child.nextSibling) {
      var add = child
      if (child.nodeType == 3) {
        var text = child.nodeValue.replace(/\ufeff/g, "")
        if (!text) { continue }
        add = document.createTextNode(text)
      }
      if (!content) { content = document.createDocumentFragment() }
      content.appendChild(add)
    }
    if (content) { return {skip: content} }
    else { return WidgetViewDesc.prototype.parseRule.call(this) }
  };

  CursorWrapperDesc.prototype.ignoreMutation = function () { return false };

  return CursorWrapperDesc;
}(WidgetViewDesc));

// A mark desc represents a mark. May have multiple children,
// depending on how the mark is split. Note that marks are drawn using
// a fixed nesting order, for simplicity and predictability, so in
// some cases they will be split more often than would appear
// necessary.
var MarkViewDesc = (function (ViewDesc) {
  function MarkViewDesc(parent, mark, dom) {
    ViewDesc.call(this, parent, [], dom, dom)
    this.mark = mark
  }

  if ( ViewDesc ) MarkViewDesc.__proto__ = ViewDesc;
  MarkViewDesc.prototype = Object.create( ViewDesc && ViewDesc.prototype );
  MarkViewDesc.prototype.constructor = MarkViewDesc;

  MarkViewDesc.create = function (parent, mark, view) {
    var custom = customNodeViews(view)[mark.type.name]
    var spec = custom && custom(mark, view)
    var dom = spec && spec.dom || DOMSerializer.renderSpec(document, mark.type.spec.toDOM(mark)).dom
    return new MarkViewDesc(parent, mark, dom)
  };

  MarkViewDesc.prototype.parseRule = function () { return {mark: this.mark.type.name, attrs: this.mark.attrs, contentElement: this.contentDOM} };

  MarkViewDesc.prototype.matchesMark = function (mark) { return this.dirty != NODE_DIRTY && this.mark.eq(mark) };

  MarkViewDesc.prototype.markDirty = function (from, to) {
    ViewDesc.prototype.markDirty.call(this, from, to)
    // Move dirty info to nearest node view
    if (this.dirty != NOT_DIRTY) {
      var parent = this.parent
      while (!parent.node) { parent = parent.parent }
      if (parent.dirty < this.dirty) { parent.dirty = this.dirty }
      this.dirty = NOT_DIRTY
    }
  };

  return MarkViewDesc;
}(ViewDesc));

// Node view descs are the main, most common type of view desc, and
// correspond to an actual node in the document. Unlike mark descs,
// they populate their child array themselves.
var NodeViewDesc = (function (ViewDesc) {
  function NodeViewDesc(parent, node, outerDeco, innerDeco, dom, contentDOM, nodeDOM, view) {
    ViewDesc.call(this, parent, node.isLeaf ? nothing : [], dom, contentDOM)
    this.nodeDOM = nodeDOM
    this.node = node
    this.outerDeco = outerDeco
    this.innerDeco = innerDeco
    if (contentDOM) { this.updateChildren(view) }
  }

  if ( ViewDesc ) NodeViewDesc.__proto__ = ViewDesc;
  NodeViewDesc.prototype = Object.create( ViewDesc && ViewDesc.prototype );
  NodeViewDesc.prototype.constructor = NodeViewDesc;

  var prototypeAccessors$1 = { size: {},border: {} };

  // By default, a node is rendered using the `toDOM` method from the
  // node type spec. But client code can use the `nodeViews` spec to
  // supply a custom node view, which can influence various aspects of
  // the way the node works.
  //
  // (Using subclassing for this was intentionally decided against,
  // since it'd require exposing a whole slew of finnicky
  // implementation details to the user code that they probably will
  // never need.)
  NodeViewDesc.create = function (parent, node, outerDeco, innerDeco, view) {
    var custom = customNodeViews(view)[node.type.name], descObj
    var spec = custom && custom(node, view, function () {
      // (This is a function that allows the custom view to find its
      // own position)
      if (descObj && descObj.parent) { return descObj.parent.posBeforeChild(descObj) }
    }, outerDeco)

    var dom = spec && spec.dom, contentDOM = spec && spec.contentDOM
    if (node.isText) {
      if (!dom) { dom = document.createTextNode(node.text) }
      else if (dom.nodeType != 3) { throw new RangeError("Text must be rendered as a DOM text node") }
    } else if (!dom) {
      ;var assign;
      ((assign = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node)), dom = assign.dom, contentDOM = assign.contentDOM))
    }
    if (!contentDOM && !node.isText) { dom.contentEditable = false }

    var nodeDOM = dom
    dom = applyOuterDeco(dom, outerDeco, node)

    if (spec)
      { return descObj = new CustomNodeViewDesc(parent, node, outerDeco, innerDeco, dom, contentDOM, nodeDOM, spec, view) }
    else if (node.isText)
      { return new TextViewDesc(parent, node, outerDeco, innerDeco, dom, nodeDOM, view) }
    else
      { return new NodeViewDesc(parent, node, outerDeco, innerDeco, dom, contentDOM, nodeDOM, view) }
  };

  NodeViewDesc.prototype.parseRule = function () {
    var this$1 = this;

    // FIXME the assumption that this can always return the current
    // attrs means that if the user somehow manages to change the
    // attrs in the dom, that won't be picked up. Not entirely sure
    // whether this is a problem
    if (this.contentDOM && !this.contentLost)
      { return {node: this.node.type.name, attrs: this.node.attrs, contentElement: this.contentDOM} }
    else
      { return {node: this.node.type.name, attrs: this.node.attrs, getContent: function () { return this$1.contentDOM ? Fragment.empty : this$1.node.content; }} }
  };

  NodeViewDesc.prototype.matchesNode = function (node, outerDeco, innerDeco) {
    return this.dirty == NOT_DIRTY && node.eq(this.node) &&
      sameOuterDeco(outerDeco, this.outerDeco) && innerDeco.eq(this.innerDeco)
  };

  prototypeAccessors$1.size.get = function () { return this.node.nodeSize };

  prototypeAccessors$1.border.get = function () { return this.node.isLeaf ? 0 : 1 };

  // Syncs `this.children` to match `this.node.content` and the local
  // decorations, possibly introducing nesting for marks. Then, in a
  // separate step, syncs the DOM inside `this.contentDOM` to
  // `this.children`.
  NodeViewDesc.prototype.updateChildren = function (view) {
    var this$1 = this;

    var updater = new ViewTreeUpdater(this)
    iterDeco(this.node, this.innerDeco, function (widget) {
      if (widget.spec.isCursorWrapper)
        { updater.syncToMarks(widget.spec.marks, view) }
      // If the next node is a desc matching this widget, reuse it,
      // otherwise insert the widget as a new view desc.
      updater.placeWidget(widget)
    }, function (child, outerDeco, innerDeco, i) {
      // Make sure the wrapping mark descs match the node's marks.
      updater.syncToMarks(child.marks, view)
      // Either find an existing desc that exactly matches this node,
      // and drop the descs before it.
      updater.findNodeMatch(child, outerDeco, innerDeco) ||
        // Or try updating the next desc to reflect this node.
        updater.updateNextNode(child, outerDeco, innerDeco, view, this$1.node.content, i) ||
        // Or just add it as a new desc.
        updater.addNode(child, outerDeco, innerDeco, view)
    })
    // Drop all remaining descs after the current position.
    updater.syncToMarks(nothing, view)
    if (this.node.isTextblock) { updater.addTextblockHacks() }
    updater.destroyRest()

    // Sync the DOM if anything changed
    if (updater.changed || this.dirty == CONTENT_DIRTY) { this.renderChildren() }
  };

  NodeViewDesc.prototype.renderChildren = function () {
    renderDescs(this.contentDOM, this.children, NodeViewDesc.is)
    if (browser.ios) { iosHacks(this.dom) }
  };

  // : (Node, [Decoration], DecorationSet, EditorView) → bool
  // If this desc be updated to match the given node decoration,
  // do so and return true.
  NodeViewDesc.prototype.update = function (node, outerDeco, innerDeco, view) {
    if (this.dirty == NODE_DIRTY ||
        !node.sameMarkup(this.node)) { return false }
    this.updateInner(node, outerDeco, innerDeco, view)
    return true
  };

  NodeViewDesc.prototype.updateInner = function (node, outerDeco, innerDeco, view) {
    this.updateOuterDeco(outerDeco)
    this.node = node
    this.innerDeco = innerDeco
    if (this.contentDOM) { this.updateChildren(view) }
    this.dirty = NOT_DIRTY
  };

  NodeViewDesc.prototype.updateOuterDeco = function (outerDeco) {
    if (sameOuterDeco(outerDeco, this.outerDeco)) { return }
    var needsWrap = this.nodeDOM.nodeType != 1
    var oldDOM = this.dom
    this.dom = patchOuterDeco(this.dom, this.nodeDOM,
                              computeOuterDeco(this.outerDeco, this.node, needsWrap),
                              computeOuterDeco(outerDeco, this.node, needsWrap))
    if (this.dom != oldDOM) {
      oldDOM.pmViewDesc = null
      this.dom.pmViewDesc = this
    }
    this.outerDeco = outerDeco
  };

  // Mark this node as being the selected node.
  NodeViewDesc.prototype.selectNode = function () {
    this.nodeDOM.classList.add("ProseMirror-selectednode")
  };

  // Remove selected node marking from this node.
  NodeViewDesc.prototype.deselectNode = function () {
    this.nodeDOM.classList.remove("ProseMirror-selectednode")
  };

  Object.defineProperties( NodeViewDesc.prototype, prototypeAccessors$1 );

  return NodeViewDesc;
}(ViewDesc));

// Create a view desc for the top-level document node, to be exported
// and used by the view class.
function docViewDesc(doc, outerDeco, innerDeco, dom, view) {
  applyOuterDeco(dom, outerDeco, doc, true)
  return new NodeViewDesc(null, doc, outerDeco, innerDeco, dom, dom, dom, view)
}
exports.docViewDesc = docViewDesc

var TextViewDesc = (function (NodeViewDesc) {
  function TextViewDesc(parent, node, outerDeco, innerDeco, dom, nodeDOM, view) {
    NodeViewDesc.call(this, parent, node, outerDeco, innerDeco, dom, null, nodeDOM, view)
  }

  if ( NodeViewDesc ) TextViewDesc.__proto__ = NodeViewDesc;
  TextViewDesc.prototype = Object.create( NodeViewDesc && NodeViewDesc.prototype );
  TextViewDesc.prototype.constructor = TextViewDesc;

  TextViewDesc.prototype.parseRule = function () {
    return {skip: this.nodeDOM.parentNode}
  };

  TextViewDesc.prototype.update = function (node, outerDeco) {
    if (this.dirty == NODE_DIRTY || (this.dirty != NOT_DIRTY && !this.inParent()) ||
        !node.sameMarkup(this.node)) { return false }
    this.updateOuterDeco(outerDeco)
    if ((this.dirty != NOT_DIRTY || node.text != this.node.text) && node.text != this.nodeDOM.nodeValue)
      { this.nodeDOM.nodeValue = node.text }
    this.node = node
    this.dirty = NOT_DIRTY
    return true
  };

  TextViewDesc.prototype.inParent = function () {
    var parentDOM = this.parent.contentDOM
    for (var n = this.nodeDOM; n; n = n.parentNode) { if (n == parentDOM) { return true } }
    return false
  };

  TextViewDesc.prototype.domFromPos = function (pos) {
    return {node: this.nodeDOM, offset: pos}
  };

  TextViewDesc.prototype.localPosFromDOM = function (dom, offset, bias) {
    if (dom == this.nodeDOM) { return this.posAtStart + Math.min(offset, this.node.text.length) }
    return NodeViewDesc.prototype.localPosFromDOM.call(this, dom, offset, bias)
  };

  TextViewDesc.prototype.ignoreMutation = function (mutation) {
    return mutation.type != "characterData"
  };

  return TextViewDesc;
}(NodeViewDesc));

// A dummy desc used to tag trailing BR or span nodes created to work
// around contentEditable terribleness.
var BRHackViewDesc = (function (ViewDesc) {
  function BRHackViewDesc () {
    ViewDesc.apply(this, arguments);
  }

  if ( ViewDesc ) BRHackViewDesc.__proto__ = ViewDesc;
  BRHackViewDesc.prototype = Object.create( ViewDesc && ViewDesc.prototype );
  BRHackViewDesc.prototype.constructor = BRHackViewDesc;

  BRHackViewDesc.prototype.parseRule = function () { return {ignore: true} };
  BRHackViewDesc.prototype.matchesHack = function () { return this.dirty == NOT_DIRTY };

  return BRHackViewDesc;
}(ViewDesc));

// A separate subclass is used for customized node views, so that the
// extra checks only have to be made for nodes that are actually
// customized.
var CustomNodeViewDesc = (function (NodeViewDesc) {
  function CustomNodeViewDesc(parent, node, outerDeco, innerDeco, dom, contentDOM, nodeDOM, spec, view) {
    NodeViewDesc.call(this, parent, node, outerDeco, innerDeco, dom, contentDOM, nodeDOM, view)
    this.spec = spec
  }

  if ( NodeViewDesc ) CustomNodeViewDesc.__proto__ = NodeViewDesc;
  CustomNodeViewDesc.prototype = Object.create( NodeViewDesc && NodeViewDesc.prototype );
  CustomNodeViewDesc.prototype.constructor = CustomNodeViewDesc;

  // A custom `update` method gets to decide whether the update goes
  // through. If it does, and there's a `contentDOM` node, our logic
  // updates the children.
  CustomNodeViewDesc.prototype.update = function (node, outerDeco, innerDeco, view) {
    if (this.dirty == NODE_DIRTY) { return false }
    if (this.spec.update) {
      var result = this.spec.update(node, outerDeco)
      if (result) { this.updateInner(node, outerDeco, innerDeco, view) }
      return result
    } else if (!this.contentDOM && !node.isLeaf) {
      return false
    } else {
      return NodeViewDesc.prototype.update.call(this, node, outerDeco, this.contentDOM ? this.innerDeco : innerDeco, view)
    }
  };

  CustomNodeViewDesc.prototype.selectNode = function () {
    this.spec.selectNode ? this.spec.selectNode() : NodeViewDesc.prototype.selectNode.call(this)
  };

  CustomNodeViewDesc.prototype.deselectNode = function () {
    this.spec.deselectNode ? this.spec.deselectNode() : NodeViewDesc.prototype.deselectNode.call(this)
  };

  CustomNodeViewDesc.prototype.setSelection = function (anchor, head, root) {
    this.spec.setSelection ? this.spec.setSelection(anchor, head, root) : NodeViewDesc.prototype.setSelection.call(this, anchor, head, root)
  };

  CustomNodeViewDesc.prototype.destroy = function () {
    if (this.spec.destroy) { this.spec.destroy() }
    NodeViewDesc.prototype.destroy.call(this)
  };

  CustomNodeViewDesc.prototype.stopEvent = function (event) {
    return this.spec.stopEvent ? this.spec.stopEvent(event) : false
  };

  CustomNodeViewDesc.prototype.ignoreMutation = function (mutation) {
    return this.spec.ignoreMutation ? this.spec.ignoreMutation(mutation) : NodeViewDesc.prototype.ignoreMutation.call(this, mutation)
  };

  return CustomNodeViewDesc;
}(NodeViewDesc));

// : (dom.Node, [ViewDesc])
// Sync the content of the given DOM node with the nodes associated
// with the given array of view descs, recursing into mark descs
// because this should sync the subtree for a whole node at a time.
function renderDescs(parentDOM, descs) {
  var dom = parentDOM.firstChild
  for (var i = 0; i < descs.length; i++) {
    var desc = descs[i], childDOM = desc.dom
    if (childDOM.parentNode == parentDOM) {
      while (childDOM != dom) { dom = rm(dom) }
      dom = dom.nextSibling
    } else {
      parentDOM.insertBefore(childDOM, dom)
    }
    if (desc instanceof MarkViewDesc) {
      var pos = dom ? dom.previousSibling : parentDOM.lastChild
      renderDescs(desc.contentDOM, desc.children)
      dom = pos ? pos.nextSibling : parentDOM.firstChild
    }
  }
  while (dom) { dom = rm(dom) }
}

function OuterDecoLevel(nodeName) {
  if (nodeName) { this.nodeName = nodeName }
}
OuterDecoLevel.prototype = Object.create(null)

var noDeco = [new OuterDecoLevel]

function computeOuterDeco(outerDeco, node, needsWrap) {
  if (outerDeco.length == 0) { return noDeco }

  var top = needsWrap ? noDeco[0] : new OuterDecoLevel, result = [top]

  for (var i = 0; i < outerDeco.length; i++) {
    var attrs = outerDeco[i].type.attrs, cur = top
    if (!attrs) { continue }
    if (attrs.nodeName)
      { result.push(cur = new OuterDecoLevel(attrs.nodeName)) }

    for (var name in attrs) {
      var val = attrs[name]
      if (val == null) { continue }
      if (needsWrap && result.length == 1)
        { result.push(cur = top = new OuterDecoLevel(node.isInline ? "span" : "div")) }
      if (name == "class") { cur.class = (cur.class ? cur.class + " " : "") + val }
      else if (name == "style") { cur.style = (cur.style ? cur.style + ";" : "") + val }
      else if (name != "nodeName") { cur[name] = val }
    }
  }

  return result
}

function patchOuterDeco(outerDOM, nodeDOM, prevComputed, curComputed) {
  // Shortcut for trivial case
  if (prevComputed == noDeco && curComputed == noDeco) { return nodeDOM }

  var curDOM = nodeDOM
  for (var i = 0; i < curComputed.length; i++) {
    var deco = curComputed[i], prev = prevComputed[i]
    if (i) {
      var parent = (void 0)
      if (prev && prev.nodeName == deco.nodeName && curDOM != outerDOM &&
          (parent = nodeDOM.parentNode) && parent.tagName.toLowerCase() == deco.nodeName) {
        curDOM = parent
      } else {
        parent = document.createElement(deco.nodeName)
        parent.appendChild(curDOM)
        curDOM = parent
      }
    }
    patchAttributes(curDOM, prev || noDeco[0], deco)
  }
  return curDOM
}

function patchAttributes(dom, prev, cur) {
  for (var name in prev)
    { if (name != "class" && name != "style" && name != "nodeName" && !(name in cur))
      { dom.removeAttribute(name) } }
  for (var name$1 in cur)
    { if (name$1 != "class" && name$1 != "style" && name$1 != "nodeName" && cur[name$1] != prev[name$1])
      { dom.setAttribute(name$1, cur[name$1]) } }
  if (prev.class != cur.class) {
    var prevList = prev.class ? prev.class.split(" ") : nothing
    var curList = cur.class ? cur.class.split(" ") : nothing
    for (var i = 0; i < prevList.length; i++) { if (curList.indexOf(prevList[i]) == -1)
      { dom.classList.remove(prevList[i]) } }
    for (var i$1 = 0; i$1 < curList.length; i$1++) { if (prevList.indexOf(curList[i$1]) == -1)
      { dom.classList.add(curList[i$1]) } }
  }
  if (prev.style != cur.style) {
    var text = dom.style.cssText, found
    if (prev.style && (found = text.indexOf(prev.style)) > -1)
      { text = text.slice(0, found) + text.slice(found + prev.style.length) }
    dom.style.cssText = text + (cur.style || "")
  }
}

function applyOuterDeco(dom, deco, node) {
  return patchOuterDeco(dom, dom, noDeco, computeOuterDeco(deco, node, dom.nodeType != 1))
}

// : ([Decoration], [Decoration]) → bool
function sameOuterDeco(a, b) {
  if (a.length != b.length) { return false }
  for (var i = 0; i < a.length; i++) { if (!a[i].type.eq(b[i].type)) { return false } }
  return true
}

// Remove a DOM node and return its next sibling.
function rm(dom) {
  var next = dom.nextSibling
  dom.parentNode.removeChild(dom)
  return next
}

// Helper class for incrementally updating a tree of mark descs and
// the widget and node descs inside of them.
var ViewTreeUpdater = function(top) {
  this.top = top
  // Index into `this.top`'s child array, represents the current
  // update position.
  this.index = 0
  // When entering a mark, the current top and index are pushed
  // onto this.
  this.stack = []
  // Tracks whether anything was changed
  this.changed = false
};

// Destroy and remove the children between the given indices in
// `this.top`.
ViewTreeUpdater.prototype.destroyBetween = function (start, end) {
    var this$1 = this;

  if (start == end) { return }
  for (var i = start; i < end; i++) { this$1.top.children[i].destroy() }
  this.top.children.splice(start, end - start)
  this.changed = true
};

// Destroy all remaining children in `this.top`.
ViewTreeUpdater.prototype.destroyRest = function () {
  this.destroyBetween(this.index, this.top.children.length)
};

// : ([Mark], EditorView)
// Sync the current stack of mark descs with the given array of
// marks, reusing existing mark descs when possible.
ViewTreeUpdater.prototype.syncToMarks = function (marks, view) {
    var this$1 = this;

  var keep = 0, depth = this.stack.length >> 1
  var maxKeep = Math.min(depth, marks.length), next
  while (keep < maxKeep &&
         (keep == depth - 1 ? this.top : this.stack[(keep + 1) << 1]).matchesMark(marks[keep]))
    { keep++ }

  while (keep < depth) {
    this$1.destroyRest()
    this$1.top.dirty = NOT_DIRTY
    this$1.index = this$1.stack.pop()
    this$1.top = this$1.stack.pop()
    depth--
  }
  while (depth < marks.length) {
    this$1.stack.push(this$1.top, this$1.index + 1)
    if (this$1.index < this$1.top.children.length &&
        (next = this$1.top.children[this$1.index]).matchesMark(marks[depth])) {
      this$1.top = next
    } else {
      var markDesc = MarkViewDesc.create(this$1.top, marks[depth], view)
      this$1.top.children.splice(this$1.index, 0, markDesc)
      this$1.top = markDesc
      this$1.changed = true
    }
    this$1.index = 0
    depth++
  }
};

// : (Node, [Decoration], DecorationSet) → bool
// Try to find a node desc matching the given data. Skip over it and
// return true when successful.
ViewTreeUpdater.prototype.findNodeMatch = function (node, outerDeco, innerDeco) {
    var this$1 = this;

  for (var i = this.index, children = this.top.children, e = Math.min(children.length, i + 5); i < e; i++) {
    if (children[i].matchesNode(node, outerDeco, innerDeco)) {
      this$1.destroyBetween(this$1.index, i)
      this$1.index++
      return true
    }
  }
  return false
};

// : (Node, [Decoration], DecorationSet, EditorView, Fragment, number) → bool
// Try to update the next node, if any, to the given data. First
// tries scanning ahead in the siblings fragment to see if the next
// node matches any of those, and if so, doesn't touch it, to avoid
// overwriting nodes that could still be used.
ViewTreeUpdater.prototype.updateNextNode = function (node, outerDeco, innerDeco, view, siblings, index) {
  if (this.index == this.top.children.length) { return false }
  var next = this.top.children[this.index]
  if (next instanceof NodeViewDesc) {
    for (var i = index + 1, e = Math.min(siblings.childCount, i + 5); i < e; i++)
      { if (next.node == siblings.child(i)) { return false } }
    var nextDOM = next.dom
    if (next.update(node, outerDeco, innerDeco, view)) {
      if (next.dom != nextDOM) { this.changed = true }
      this.index++
      return true
    }
  }
  return false
};

// : (Node, [Decoration], DecorationSet, EditorView)
// Insert the node as a newly created node desc.
ViewTreeUpdater.prototype.addNode = function (node, outerDeco, innerDeco, view) {
  this.top.children.splice(this.index++, 0, NodeViewDesc.create(this.top, node, outerDeco, innerDeco, view))
  this.changed = true
};

ViewTreeUpdater.prototype.placeWidget = function (widget) {
  if (this.index < this.top.children.length && this.top.children[this.index].matchesWidget(widget)) {
    this.index++
  } else {
    var desc = new (widget.spec.isCursorWrapper ? CursorWrapperDesc : WidgetViewDesc)(this.top, widget)
    this.top.children.splice(this.index++, 0, desc)
    this.changed = true
  }
};

// Make sure a textblock looks and behaves correctly in
// contentEditable.
ViewTreeUpdater.prototype.addTextblockHacks = function () {
  var lastChild = this.top.children[this.index - 1]
  while (lastChild instanceof MarkViewDesc) { lastChild = lastChild.children[lastChild.children.length - 1] }

  if (!lastChild || // Empty textblock
      !(lastChild instanceof TextViewDesc) ||
      /\n$/.test(lastChild.node.text)) {
    if (this.index < this.top.children.length && this.top.children[this.index].matchesHack()) {
      this.index++
    } else {
      var dom = document.createElement("br")
      this.top.children.splice(this.index++, 0, new BRHackViewDesc(this.top, nothing, dom, null))
      this.changed = true
    }
  }
};

// : (ViewDesc, DecorationSet, (Decoration), (Node, [Decoration], DecorationSet))
// This function abstracts iterating over the nodes and decorations in
// a fragment. Calls `onNode` for each node, with its local and child
// decorations. Splits text nodes when there is a decoration starting
// or ending inside of them. Calls `onWidget` for each widget.
function iterDeco(parent, deco, onWidget, onNode) {
  var locals = deco.locals(parent), offset = 0
  // Simple, cheap variant for when there are no local decorations
  if (locals.length == 0) {
    for (var i = 0; i < parent.childCount; i++) {
      var child = parent.child(i)
      onNode(child, locals, deco.forChild(offset, child), i)
      offset += child.nodeSize
    }
    return
  }

  var decoIndex = 0, active = [], restNode = null
  for (var parentIndex = 0;;) {
    while (decoIndex < locals.length && locals[decoIndex].to == offset)
      { onWidget(locals[decoIndex++]) }

    var child$1 = (void 0)
    if (restNode) {
      child$1 = restNode
      restNode = null
    } else if (parentIndex < parent.childCount) {
      child$1 = parent.child(parentIndex++)
    } else {
      break
    }

    for (var i$1 = 0; i$1 < active.length; i$1++) { if (active[i$1].to <= offset) { active.splice(i$1--, 1) } }
    while (decoIndex < locals.length && locals[decoIndex].from == offset) { active.push(locals[decoIndex++]) }

    var end = offset + child$1.nodeSize
    if (child$1.isText) {
      var cutAt = end
      if (decoIndex < locals.length && locals[decoIndex].from < cutAt) { cutAt = locals[decoIndex].from }
      for (var i$2 = 0; i$2 < active.length; i$2++) { if (active[i$2].to < cutAt) { cutAt = active[i$2].to } }
      if (cutAt < end) {
        restNode = child$1.cut(cutAt - offset)
        child$1 = child$1.cut(0, cutAt - offset)
        end = cutAt
      }
    }

    onNode(child$1, active.length ? active.slice() : nothing, deco.forChild(offset, child$1), parentIndex - 1)
    offset = end
  }
}

// Pre-calculate and cache the set of custom view specs for a given
// prop object.
var cachedCustomViews, cachedCustomFor
function customNodeViews(view) {
  if (cachedCustomFor == view._props) { return cachedCustomViews }
  cachedCustomFor = view._props
  return cachedCustomViews = buildCustomViews(view)
}
function buildCustomViews(view) {
  var result = {}
  view.someProp("nodeViews", function (obj) {
    for (var prop in obj) { if (!Object.prototype.hasOwnProperty.call(result, prop))
      { result[prop] = obj[prop] } }
  })
  return result
}

// List markers in Mobile Safari will mysteriously disappear
// sometimes. This works around that.
function iosHacks(dom) {
  if (dom.nodeName == "UL" || dom.nodeName == "OL") {
    var oldCSS = dom.style.cssText
    dom.style.cssText = oldCSS + "; list-style: square !important"
    window.getComputedStyle(dom).listStyle
    dom.style.cssText = oldCSS
  }
}
