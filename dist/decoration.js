function compareObjs(a, b) {
  if (a == b) { return true }
  for (var p in a) { if (a[p] !== b[p]) { return false } }
  for (var p$1 in b) { if (!(p$1 in a)) { return false } }
  return true
}

var WidgetType = function(widget, spec) {
  this.spec = spec || noSpec
  if (!this.spec.raw) {
    if (widget.nodeType != 1) {
      var wrap = document.createElement("span")
      wrap.appendChild(widget)
      widget = wrap
    }
    widget.contentEditable = false
    widget.classList.add("ProseMirror-widget")
  }
  this.widget = widget
};

WidgetType.prototype.map = function (mapping, span, offset, oldOffset) {
  var ref = mapping.mapResult(span.from + oldOffset, this.spec.associative == "left" ? -1 : 1);
    var pos = ref.pos;
    var deleted = ref.deleted;
  return deleted ? null : new Decoration(pos - offset, pos - offset, this)
};

WidgetType.prototype.valid = function () { return true };

WidgetType.prototype.eq = function (other) {
  return this == other ||
    (other instanceof WidgetType && (this.widget == other.widget || this.spec.key) &&
     compareObjs(this.spec, other.spec))
};

var InlineType = function(attrs, spec) {
  this.spec = spec || noSpec
  this.attrs = attrs
};

InlineType.prototype.map = function (mapping, span, offset, oldOffset) {
  var from = mapping.map(span.from + oldOffset, this.spec.inclusiveLeft ? -1 : 1) - offset
  var to = mapping.map(span.to + oldOffset, this.spec.inclusiveRight ? 1 : -1) - offset
  return from >= to ? null : new Decoration(from, to, this)
};

InlineType.prototype.valid = function (_, span) { return span.from < span.to };

InlineType.prototype.eq = function (other) {
  return this == other ||
    (other instanceof InlineType && compareObjs(this.attrs, other.attrs) &&
     compareObjs(this.spec, other.spec))
};

InlineType.is = function (span) { return span.type instanceof InlineType };

var NodeType = function(attrs, spec) {
  this.spec = spec || noSpec
  this.attrs = attrs
};

NodeType.prototype.map = function (mapping, span, offset, oldOffset) {
  var from = mapping.mapResult(span.from + oldOffset, 1)
  if (from.deleted) { return null }
  var to = mapping.mapResult(span.to + oldOffset, -1)
  if (to.deleted || to.pos <= from.pos) { return null }
  return new Decoration(from.pos - offset, to.pos - offset, this)
};

NodeType.prototype.valid = function (node, span) {
  var ref = node.content.findIndex(span.from);
    var index = ref.index;
    var offset = ref.offset;
  return offset == span.from && offset + node.child(index).nodeSize == span.to
};

NodeType.prototype.eq = function (other) {
  return this == other ||
    (other instanceof NodeType && compareObjs(this.attrs, other.attrs) &&
     compareObjs(this.spec, other.spec))
};

// ::- Decorations can be provided to the view (through the
// [`decorations` prop](#view.EditorProps.decorations)) to adjust the
// way the document is drawn. They come in several variants. See the
// static members of this class for details.
var Decoration = function(from, to, type) {
  this.from = from
  this.to = to
  this.type = type
};

var prototypeAccessors = { spec: {} };

Decoration.prototype.copy = function (from, to) {
  return new Decoration(from, to, this.type)
};

Decoration.prototype.eq = function (other) {
  return this.type.eq(other.type) && this.from == other.from && this.to == other.to
};

Decoration.prototype.map = function (mapping, offset, oldOffset) {
  return this.type.map(mapping, this, offset, oldOffset)
};

// :: (number, dom.Node, ?Object) → Decoration
// Creates a widget decoration, which is a DOM node that's shown in
// the document at the given position.
//
// spec::- These options are supported:
//
//   associative:: ?string
//   By default, widgets are right-associative, meaning they end
//   up to the right of content inserted at their position. You
//   can set this to `"left"` to make it left-associative, so that
//   the inserted content will end up after the widget.
//
//   stopEvent:: ?(event: dom.Event) → bool
//   Can be used to control which DOM events, when they bubble out
//   of this widget, the editor view should ignore.
//
//   key:: ?string
//   When comparing decorations of this type (in order to decide
//   whether it needs to be redrawn), ProseMirror will by default
//   compare the widget DOM node by identity. If you pass a key,
//   that key will be compared instead, which can be useful when
//   you generate decorations on the fly and don't want to store
//   and reuse DOM nodes.
Decoration.widget = function (pos, dom, spec) {
  return new Decoration(pos, pos, new WidgetType(dom, spec))
};

// :: (number, number, DecorationAttrs, ?Object) → Decoration
// Creates an inline decoration, which adds the given attributes to
// each inline node between `from` and `to`.
//
// spec::- These options are recognized:
//
//   inclusiveLeft:: ?bool
//   Determines how the left side of the decoration is
//   [mapped](#transform.Position_Mapping) when content is
//   inserted directly at that positon. By default, the decoration
//   won't include the new content, but you can set this to `true`
//   to make it inclusive.
//
//   inclusiveRight:: ?bool
//   Determines how the right side of the decoration is mapped.
//   See
//   [`inclusiveLeft`](#view.Decoration^inline^spec.inclusiveLeft).
Decoration.inline = function (from, to, attrs, spec) {
  return new Decoration(from, to, new InlineType(attrs, spec))
};

// :: (number, number, DecorationAttrs, ?Object) → Decoration
// Creates a node decoration. `from` and `to` should point precisely
// before and after a node in the document. That node, and only that
// node, will receive the given attributes.
Decoration.node = function (from, to, attrs, spec) {
  return new Decoration(from, to, new NodeType(attrs, spec))
};

// :: Object
// The spec provided when creating this decoration. Can be useful
// if you've stored extra information in that object.
prototypeAccessors.spec.get = function () { return this.type.spec };

Object.defineProperties( Decoration.prototype, prototypeAccessors );
exports.Decoration = Decoration

// DecorationAttrs:: interface
// A set of attributes to add to a decorated node. Most properties
// simply directly correspond to DOM attributes of the same name,
// which will be set to the property's value. These are exceptions:
//
//   class:: ?string
//   A CSS class name or a space-separated set of class names to be
//   _added_ to the classes that the node already had.
//
//   style:: ?string
//   A string of CSS to be _added_ to the node's existing `style` property.
//
//   nodeName:: ?string
//   When non-null, the target node is wrapped in a DOM element of
//   this type (and the other attributes are applied to this element).

var none = [], noSpec = {}

// ::- A collection of [decorations](#view.Decoration), organized in
// such a way that the drawing algorithm can efficiently use and
// compare them. This is a persistent data structure—it is not
// modified, updates create a new value.
var DecorationSet = function(local, children) {
  this.local = local && local.length ? local : none
  this.children = children && children.length ? children : none
};

// :: (Node, [Decoration]) → DecorationSet
// Create a set of decorations, using the structure of the given
// document.
DecorationSet.create = function (doc, decorations) {
  return decorations.length ? buildTree(decorations, doc, 0, noSpec) : empty
};

// :: (?number, ?number) → [Decoration]
// Find all decorations in this set which touch the given range
// (including decorations that start or end directly at the
// boundaries). When the arguments are omitted, all decorations in
// the set are collected.
DecorationSet.prototype.find = function (start, end) {
  var result = []
  this.findInner(start == null ? 0 : start, end == null ? 1e9 : end, result, 0)
  return result
};

DecorationSet.prototype.findInner = function (start, end, result, offset) {
    var this$1 = this;

  for (var i = 0; i < this.local.length; i++) {
    var span = this$1.local[i]
    if (span.from <= end && span.to >= start)
      { result.push(span.copy(span.from + offset, span.to + offset)) }
  }
  for (var i$1 = 0; i$1 < this.children.length; i$1 += 3) {
    if (this$1.children[i$1] < end && this$1.children[i$1 + 1] > start) {
      var childOff = this$1.children[i$1] + 1
      this$1.children[i$1 + 2].findInner(start - childOff, end - childOff, result, offset + childOff)
    }
  }
};

// :: (Mapping, Node, ?Object) → DecorationSet
// Map the set of decorations in response to a change in the
// document.
//
// options::- An optional set of options.
//
//   onRemove:: ?(decorationSpec: Object)
//   When given, this function will be called for each decoration
//   that gets dropped as a result of the mapping, passing the
//   spec of that decoration.
DecorationSet.prototype.map = function (mapping, doc, options) {
  if (this == empty || mapping.maps.length == 0) { return this }
  return this.mapInner(mapping, doc, 0, 0, options || noSpec)
};

DecorationSet.prototype.mapInner = function (mapping, node, offset, oldOffset, options) {
    var this$1 = this;

  var newLocal
  for (var i = 0; i < this.local.length; i++) {
    var mapped = this$1.local[i].map(mapping, offset, oldOffset)
    if (mapped && mapped.type.valid(node, mapped)) { (newLocal || (newLocal = [])).push(mapped) }
    else if (options.onRemove) { options.onRemove(this$1.local[i].spec) }
  }

  if (this.children.length)
    { return mapChildren(this.children, newLocal, mapping, node, offset, oldOffset, options) }
  else
    { return newLocal ? new DecorationSet(newLocal.sort(byPos)) : empty }
};

// :: (Node, [Decoration]) → DecorationSet
// Add the given array of decorations to the ones in the set,
// producing a new set. Needs access to the current document to
// create the appropriate tree structure.
DecorationSet.prototype.add = function (doc, decorations) {
  if (!decorations.length) { return this }
  if (this == empty) { return DecorationSet.create(doc, decorations) }
  return this.addInner(doc, decorations, 0)
};

DecorationSet.prototype.addInner = function (doc, decorations, offset) {
    var this$1 = this;

  var children, childIndex = 0
  doc.forEach(function (childNode, childOffset) {
    var baseOffset = childOffset + offset, found
    if (!(found = takeSpansForNode(decorations, childNode, baseOffset))) { return }

    if (!children) { children = this$1.children.slice() }
    while (childIndex < children.length && children[childIndex] < childOffset) { childIndex += 3 }
    if (children[childIndex] == childOffset)
      { children[childIndex + 2] = children[childIndex + 2].addInner(childNode, found, baseOffset + 1) }
    else
      { children.splice(childIndex, 0, childOffset, childOffset + childNode.nodeSize, buildTree(found, childNode, baseOffset + 1, noSpec)) }
    childIndex += 3
  })

  var local = moveSpans(childIndex ? withoutNulls(decorations) : decorations, -offset)
  return new DecorationSet(local.length ? this.local.concat(local).sort(byPos) : this.local,
                           children || this.children)
};

// :: ([Decoration]) → DecorationSet
// Create a new set that contains the decorations in this set, minus
// the ones in the given array.
DecorationSet.prototype.remove = function (decorations) {
  if (decorations.length == 0 || this == empty) { return this }
  return this.removeInner(decorations, 0)
};

DecorationSet.prototype.removeInner = function (decorations, offset) {
    var this$1 = this;

  var children = this.children, local = this.local
  for (var i = 0; i < children.length; i += 3) {
    var found = (void 0), from = children[i] + offset, to = children[i + 1] + offset
    for (var j = 0, span = (void 0); j < decorations.length; j++) { if (span = decorations[j]) {
      if (span.from > from && span.to < to) {
        decorations[j] = null
        ;(found || (found = [])).push(span)
      }
    } }
    if (!found) { continue }
    if (children == this$1.children) { children = this$1.children.slice() }
    var removed = children[i + 2].removeInner(found, from + 1)
    if (removed != empty) {
      children[i + 2] = removed
    } else {
      children.splice(i, 3)
      i -= 3
    }
  }
  if (local.length) { for (var i$1 = 0, span$1 = (void 0); i$1 < decorations.length; i$1++) { if (span$1 = decorations[i$1]) {
    for (var j$1 = 0; j$1 < local.length; j$1++) { if (local[j$1].type == span$1.type) {
      if (local == this$1.local) { local = this$1.local.slice() }
      local.splice(j$1--, 1)
    } }
  } } }
  if (children == this.children && local == this.local) { return this }
  return local.length || children.length ? new DecorationSet(local, children) : empty
};

DecorationSet.prototype.forChild = function (offset, node) {
    var this$1 = this;

  if (this == empty) { return this }
  if (node.isLeaf) { return DecorationSet.empty }

  var child, local
  for (var i = 0; i < this.children.length; i += 3) { if (this$1.children[i] >= offset) {
    if (this$1.children[i] == offset) { child = this$1.children[i + 2] }
    break
  } }
  var start = offset + 1, end = start + node.content.size
  for (var i$1 = 0; i$1 < this.local.length; i$1++) {
    var dec = this$1.local[i$1]
    if (dec.from < end && dec.to > start && (dec.type instanceof InlineType)) {
      var from = Math.max(start, dec.from) - start, to = Math.min(end, dec.to) - start
      if (from < to) { (local || (local = [])).push(dec.copy(from, to)) }
    }
  }
  if (local) {
    var localSet = new DecorationSet(local)
    return child ? new DecorationGroup([localSet, child]) : localSet
  }
  return child || empty
};

DecorationSet.prototype.eq = function (other) {
    var this$1 = this;

  if (this == other) { return true }
  if (!(other instanceof DecorationSet) ||
      this.local.length != other.local.length ||
      this.children.length != other.children.length) { return false }
  for (var i = 0; i < this.local.length; i++)
    { if (!this$1.local[i].eq(other.local[i])) { return false } }
  for (var i$1 = 0; i$1 < this.children.length; i$1 += 3)
    { if (this$1.children[i$1] != other.children[i$1] ||
        this$1.children[i$1 + 1] != other.children[i$1 + 1] ||
        !this$1.children[i$1 + 2].eq(other.children[i$1 + 2])) { return false } }
  return false
};

DecorationSet.prototype.locals = function (node) {
  return removeOverlap(this.localsInner(node))
};

DecorationSet.prototype.localsInner = function (node) {
    var this$1 = this;

  if (this == empty) { return none }
  if (node.inlineContent || !this.local.some(InlineType.is)) { return this.local }
  var result = []
  for (var i = 0; i < this.local.length; i++) {
    if (!(this$1.local[i].type instanceof InlineType))
      { result.push(this$1.local[i]) }
  }
  return result
};
exports.DecorationSet = DecorationSet

var empty = new DecorationSet()

// :: DecorationSet
// The empty set of decorations.
DecorationSet.empty = empty

// :- An abstraction that allows the code dealing with decorations to
// treat multiple DecorationSet objects as if it were a single object
// with (a subset of) the same interface.
var DecorationGroup = function(members) {
  this.members = members
};

DecorationGroup.prototype.forChild = function (offset, child) {
    var this$1 = this;

  if (child.isLeaf) { return DecorationSet.empty }
  var found = []
  for (var i = 0; i < this.members.length; i++) {
    var result = this$1.members[i].forChild(offset, child)
    if (result == empty) { continue }
    if (result instanceof DecorationGroup) { found = found.concat(result.members) }
    else { found.push(result) }
  }
  return DecorationGroup.from(found)
};

DecorationGroup.prototype.eq = function (other) {
    var this$1 = this;

  if (!(other instanceof DecorationGroup) ||
      other.members.length != this.members.length) { return false }
  for (var i = 0; i < this.members.length; i++)
    { if (!this$1.members[i].eq(other.members[i])) { return false } }
  return true
};

DecorationGroup.prototype.locals = function (node) {
    var this$1 = this;

  var result, sorted = true
  for (var i = 0; i < this.members.length; i++) {
    var locals = this$1.members[i].localsInner(node)
    if (!locals.length) { continue }
    if (!result) {
      result = locals
    } else {
      if (sorted) {
        result = result.slice()
        sorted = false
      }
      for (var j = 0; j < locals.length; j++) { result.push(locals[j]) }
    }
  }
  return result ? removeOverlap(sorted ? result : result.sort(byPos)) : none
};

// : ([DecorationSet]) → union<DecorationSet, DecorationGroup>
// Create a group for the given array of decoration sets, or return
// a single set when possible.
DecorationGroup.from = function (members) {
  switch (members.length) {
    case 0: return empty
    case 1: return members[0]
    default: return new DecorationGroup(members)
  }
};

function mapChildren(oldChildren, newLocal, mapping, node, offset, oldOffset, options) {
  var children = oldChildren.slice()

  // Mark the children that are directly touched by changes, and
  // move those that are after the changes.
  var shift = function (oldStart, oldEnd, newStart, newEnd) {
    for (var i = 0; i < children.length; i += 3) {
      var end = children[i + 1], dSize = (void 0)
      if (end == -1 || oldStart > end + oldOffset) { continue }
      if (oldEnd >= children[i] + oldOffset) {
        children[i + 1] = -1
      } else if (dSize = (newEnd - newStart) - (oldEnd - oldStart)) {
        children[i] += dSize
        children[i + 1] += dSize
      }
    }
  }
  for (var i = 0; i < mapping.maps.length; i++) { mapping.maps[i].forEach(shift) }

  // Find the child nodes that still correspond to a single node,
  // recursively call mapInner on them and update their positions.
  var mustRebuild = false
  for (var i$1 = 0; i$1 < children.length; i$1 += 3) { if (children[i$1 + 1] == -1) { // Touched nodes
    var from = mapping.map(children[i$1] + oldOffset), fromLocal = from - offset
    if (fromLocal < 0 || fromLocal >= node.content.size) {
      mustRebuild = true
      continue
    }
    // Must read oldChildren because children was tagged with -1
    var to = mapping.map(oldChildren[i$1 + 1] + oldOffset, -1), toLocal = to - offset
    var ref = node.content.findIndex(fromLocal);
    var index = ref.index;
    var childOffset = ref.offset;
    var childNode = node.maybeChild(index)
    if (childNode && childOffset == fromLocal && childOffset + childNode.nodeSize == toLocal) {
      var mapped = children[i$1 + 2].mapInner(mapping, childNode, from + 1, children[i$1] + oldOffset + 1, options)
      if (mapped != empty) {
        children[i$1] = fromLocal
        children[i$1 + 1] = toLocal
        children[i$1 + 2] = mapped
      } else {
        children.splice(i$1, 3)
        i$1 -= 3
      }
    } else {
      mustRebuild = true
    }
  } }

  // Remaining children must be collected and rebuilt into the appropriate structure
  if (mustRebuild) {
    var decorations = mapAndGatherRemainingDecorations(children, newLocal ? moveSpans(newLocal, offset) : [], mapping, oldOffset, options)
    var built = buildTree(decorations, node, 0, options)
    newLocal = built.local
    for (var i$2 = 0; i$2 < children.length; i$2 += 3) { if (children[i$2 + 1] == -1) {
      children.splice(i$2, 3)
      i$2 -= 3
    } }
    for (var i$3 = 0, j = 0; i$3 < built.children.length; i$3 += 3) {
      var from$1 = built.children[i$3]
      while (j < children.length && children[j] < from$1) { j += 3 }
      children.splice(j, 0, built.children[i$3], built.children[i$3 + 1], built.children[i$3 + 2])
    }
  }

  return new DecorationSet(newLocal && newLocal.sort(byPos), children)
}

function moveSpans(spans, offset) {
  if (!offset || !spans.length) { return spans }
  var result = []
  for (var i = 0; i < spans.length; i++) {
    var span = spans[i]
    result.push(new Decoration(span.from + offset, span.to + offset, span.type))
  }
  return result
}

function mapAndGatherRemainingDecorations(children, decorations, mapping, oldOffset, options) {
  // Gather all decorations from the remaining marked children
  function gather(set, oldOffset) {
    for (var i = 0; i < set.local.length; i++) {
      var mapped = set.local[i].map(mapping, 0, oldOffset)
      if (mapped) { decorations.push(mapped) }
      else if (options.onRemove) { options.onRemove(set.local[i].spec) }
    }
    for (var i$1 = 0; i$1 < set.children.length; i$1 += 3)
      { gather(set.children[i$1 + 2], set.children[i$1] + oldOffset + 1) }
  }
  for (var i = 0; i < children.length; i += 3) { if (children[i + 1] == -1)
    { gather(children[i + 2], children[i] + oldOffset + 1) } }

  return decorations
}

function takeSpansForNode(spans, node, offset) {
  if (node.isLeaf) { return null }
  var end = offset + node.nodeSize, found = null
  for (var i = 0, span = (void 0); i < spans.length; i++) {
    if ((span = spans[i]) && span.from > offset && span.to < end) {
      ;(found || (found = [])).push(span)
      spans[i] = null
    }
  }
  return found
}

function withoutNulls(array) {
  var result = []
  for (var i = 0; i < array.length; i++)
    { if (array[i] != null) { result.push(array[i]) } }
  return result
}

// : ([Decoration], Node, number) → DecorationSet
// Build up a tree that corresponds to a set of decorations. `offset`
// is a base offset that should be subtractet from the `from` and `to`
// positions in the spans (so that we don't have to allocate new spans
// for recursive calls).
function buildTree(spans, node, offset, options) {
  var children = [], hasNulls = false
  node.forEach(function (childNode, localStart) {
    var found = takeSpansForNode(spans, childNode, localStart + offset)
    if (found) {
      hasNulls = true
      var subtree = buildTree(found, childNode, offset + localStart + 1, options)
      if (subtree != empty)
        { children.push(localStart, localStart + childNode.nodeSize, subtree) }
    }
  })
  var locals = moveSpans(hasNulls ? withoutNulls(spans) : spans, -offset).sort(byPos)
  for (var i = 0; i < locals.length; i++) { if (!locals[i].type.valid(node, locals[i])) {
    if (options.onRemove) { options.onRemove(locals[i].spec) }
    locals.splice(i--, 1)
  } }
  return locals.length || children.length ? new DecorationSet(locals, children) : empty
}

// : (Decoration, Decoration) → number
// Used to sort decorations so that ones with a low start position
// come first, and within a set with the same start position, those
// with an smaller end position come first.
function byPos(a, b) {
  return a.from - b.from || a.to - b.to
}

// : ([Decoration]) → [Decoration]
// Scan a sorted array of decorations for partially overlapping spans,
// and split those so that only fully overlapping spans are left (to
// make subsequent rendering easier). Will return the input array if
// no partially overlapping spans are found (the common case).
function removeOverlap(spans) {
  var working = spans
  for (var i = 0; i < working.length - 1; i++) {
    var span = working[i]
    if (span.from != span.to) { for (var j = i + 1; j < working.length; j++) {
      var next = working[j]
      if (next.from == span.from) {
        if (next.to != span.to) {
          if (working == spans) { working = spans.slice() }
          // Followed by a partially overlapping larger span. Split that
          // span.
          working[j] = next.copy(next.from, span.to)
          insertAhead(working, j + 1, next.copy(span.to, next.to))
        }
        continue
      } else {
        if (next.from < span.to) {
          if (working == spans) { working = spans.slice() }
          // The end of this one overlaps with a subsequent span. Split
          // this one.
          working[i] = span.copy(span.from, next.from)
          insertAhead(working, j, span.copy(next.from, span.to))
        }
        break
      }
    } }
  }
  return working
}
exports.removeOverlap = removeOverlap

function insertAhead(array, i, deco) {
  while (i < array.length && byPos(deco, array[i]) > 0) { i++ }
  array.splice(i, 0, deco)
}

// : (EditorView) → union<DecorationSet, DecorationGroup>
// Get the decorations associated with the current props of a view.
function viewDecorations(view) {
  var found = []
  view.someProp("decorations", function (f) {
    var result = f(view.state)
    if (result && result != empty) { found.push(result) }
  })
  if (view.cursorWrapper)
    { found.push(DecorationSet.create(view.state.doc, [view.cursorWrapper])) }
  return DecorationGroup.from(found)
}
exports.viewDecorations = viewDecorations
