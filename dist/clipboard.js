var ref = require("prosemirror-model");
var Slice = ref.Slice;
var Fragment = ref.Fragment;
var DOMParser = ref.DOMParser;
var DOMSerializer = ref.DOMSerializer;

// : (EditorView, Selection, dom.DataTransfer) → Slice
// Store the content of a selection in the clipboard (or whatever the
// given data transfer refers to)
function toClipboard(view, range, dataTransfer) {
  // Node selections are copied using just the node, text selection include parents
  var doc = view.state.doc, fullSlice = doc.slice(range.from, range.to, !range.node)
  var slice = fullSlice, context
  if (!range.node) {
    // Shrink slices for non-node selections to hold only the parent
    // node, store rest in context string, so that other tools don't
    // get confused
    var cut = Math.max(0, range.$from.sharedDepth(range.to) - 1)
    context = sliceContext(slice, cut)
    var content = slice.content
    for (var i = 0; i < cut; i++) { content = content.firstChild.content }
    slice = new Slice(content, slice.openLeft - cut, slice.openRight - cut)
  }

  var serializer = view.someProp("clipboardSerializer") || DOMSerializer.fromSchema(view.state.schema)
  var dom = serializer.serializeFragment(slice.content), wrap = document.createElement("div")
  wrap.appendChild(dom)
  var child = wrap.firstChild.nodeType == 1 && wrap.firstChild
  if (child) {
    if (range.node)
      { child.setAttribute("data-pm-node-selection", true) }
    else
      { child.setAttribute("data-pm-context", context) }
  }

  dataTransfer.clearData()
  dataTransfer.setData("text/html", wrap.innerHTML)
  dataTransfer.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n\n"))
  return fullSlice
}
exports.toClipboard = toClipboard

var cachedCanUpdateClipboard = null
function canUpdateClipboard(dataTransfer) {
  if (cachedCanUpdateClipboard != null) { return cachedCanUpdateClipboard }
  dataTransfer.setData("text/html", "<hr>")
  return cachedCanUpdateClipboard = dataTransfer.getData("text/html") == "<hr>"
}
exports.canUpdateClipboard = canUpdateClipboard

// : (EditorView, dom.DataTransfer, ?bool, ResolvedPos) → ?Slice
// Read a slice of content from the clipboard (or drop data).
function fromClipboard(view, dataTransfer, plainText, $context) {
  var txt = dataTransfer.getData("text/plain")
  var html = dataTransfer.getData("text/html")
  if (!html && !txt) { return null }
  var dom, inCode = $context.parent.type.spec.code
  if ((plainText || inCode || !html) && txt) {
    view.someProp("transformPastedText", function (f) { return txt = f(txt); })
    if (inCode) { return new Slice(Fragment.from(view.state.schema.text(txt)), 0, 0) }
    dom = document.createElement("div")
    txt.split(/(?:\r\n?|\n)+/).forEach(function (block) {
      dom.appendChild(document.createElement("p")).textContent = block
    })
  } else {
    view.someProp("transformPastedHTML", function (f) { return html = f(html); })
    dom = readHTML(html)
  }

  var parser = view.someProp("clipboardParser") || view.someProp("domParser") || DOMParser.fromSchema(view.state.schema)
  var slice = parser.parseSlice(dom, {preserveWhitespace: true, context: $context}), context
  if (dom.querySelector("[data-pm-node-selection]"))
    { slice = new Slice(slice.content, 0, 0) }
  else if (context = dom.querySelector("[data-pm-context]"))
    { slice = addContext(slice, context.getAttribute("data-pm-context")) }
  else // HTML wasn't created by ProseMirror. Make sure top-level siblings are coherent
    { slice = normalizeSiblings(slice, $context) }
  return slice
}
exports.fromClipboard = fromClipboard

// Takes a slice parsed with parseSlice, which means there hasn't been
// any content-expression checking done on the top nodes, tries to
// find a parent node in the current context that might fit the nodes,
// and if successful, rebuilds the slice so that it fits into that parent.
//
// This addresses the problem that Transform.replace expects a
// coherent slice, and will fail to place a set of siblings that don't
// fit anywhere in the schema.
function normalizeSiblings(slice, $context) {
  if (slice.content.childCount < 2) { return slice }
  var loop = function ( d ) {
    var parent = $context.node(d)
    var match = parent.contentMatchAt($context.index(d))
    var lastWrap = (void 0), result = []
    slice.content.forEach(function (node) {
      if (!result) { return }
      var wrap = match.findWrappingFor(node), inLast
      if (!wrap) { return result = null }
      if (inLast = result.length && lastWrap.length && addToSibling(wrap, lastWrap, node, result[result.length - 1], 0)) {
        result[result.length - 1] = inLast
      } else {
        if (result.length) { result[result.length - 1] = closeRight(result[result.length - 1], lastWrap.length) }
        var wrapped = withWrappers(node, wrap)
        result.push(wrapped)
        match = match.matchType(wrapped.type, wrapped.attrs)
        lastWrap = wrap
      }
    })
    if (result) { return { v: Slice.maxOpen(Fragment.from(result)) } }
  };

  for (var d = $context.depth; d >= 0; d--) {
    var returned = loop( d );

    if ( returned ) return returned.v;
  }
  return slice
}

function withWrappers(node, wrap, from) {
  if ( from === void 0 ) from = 0;

  for (var i = wrap.length - 1; i >= from; i--)
    { node = wrap[i].type.create(wrap[i].attrs, Fragment.from(node)) }
  return node
}

// Used to group adjacent nodes wrapped in similar parents by
// normalizeSiblings into the same parent node
function addToSibling(wrap, lastWrap, node, sibling, depth) {
  if (depth < wrap.length && depth < lastWrap.length && wrap[depth].type == lastWrap[depth].type) {
    var inner = addToSibling(wrap, lastWrap, node, sibling.lastChild, depth + 1)
    if (inner) { return sibling.copy(sibling.content.replaceChild(sibling.childCount - 1, inner)) }
    var match = sibling.contentMatchAt(sibling.childCount)
    if (depth == wrap.length - 1 ? match.matchNode(node) : match.matchType(wrap[depth + 1].type, wrap[depth + 1].attrs))
      { return sibling.copy(sibling.content.append(Fragment.from(withWrappers(node, wrap, depth + 1)))) }
  }
}

function closeRight(node, depth) {
  if (depth == 0) { return node }
  var fragment = node.content.replaceChild(node.childCount - 1, closeRight(node.lastChild, depth - 1))
  var fill = node.contentMatchAt(node.childCount).fillBefore(Fragment.empty, true)
  return node.copy(fragment.append(fill))
}

// Trick from jQuery -- some elements must be wrapped in other
// elements for innerHTML to work. I.e. if you do `div.innerHTML =
// "<td>..</td>"` the table cells are ignored.
var wrapMap = {thead: "table", colgroup: "table", col: "table colgroup",
                 tr: "table tbody", td: "table tbody tr", th: "table tbody tr"}
var detachedDoc = null
function readHTML(html) {
  var metas = /(\s*<meta [^>]*>)*/.exec(html)
  if (metas) { html = html.slice(metas[0].length) }
  var doc = detachedDoc || (detachedDoc = document.implementation.createHTMLDocument("title"))
  var elt = doc.createElement("div")
  var firstTag = /(?:<meta [^>]*>)*<([a-z][^>\s]+)/i.exec(html), wrap, depth = 0
  if (wrap = firstTag && wrapMap[firstTag[1].toLowerCase()]) {
    var nodes = wrap.split(" ")
    html = nodes.map(function (n) { return "<" + n + ">"; }).join("") + html + nodes.map(function (n) { return "</" + n + ">"; }).reverse().join("")
    depth = nodes.length
  }
  elt.innerHTML = html
  for (var i = 0; i < depth; i++) { elt = elt.firstChild }
  return elt
}

function sliceContext(slice, depth) {
  var result = [], content = slice.content
  for (var i = 0; i < depth; i++) {
    var node = content.firstChild
    result.push(node.type.name, node.type.hasRequiredAttrs() ? node.attrs : null)
    content = node.content
  }
  return JSON.stringify(result)
}

function addContext(slice, context) {
  if (!slice.size) { return slice }
  var schema = slice.content.firstChild.type.schema, array
  try { array = JSON.parse(context) }
  catch(e) { return slice }
  var content = slice.content;
  var openLeft = slice.openLeft;
  var openRight = slice.openRight;
  for (var i = array.length - 2; i >= 0; i -= 2) {
    var type = schema.nodes[array[i]]
    if (!type || type.hasRequiredAttrs()) { break }
    content = Fragment.from(type.create(array[i + 1], content))
    openLeft++; openRight++
  }
  return new Slice(content, openLeft, openRight)
}
