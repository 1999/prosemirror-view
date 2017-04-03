var browser = require("./browser")
var ref = require("./domchange");
var DOMChange = ref.DOMChange;
var ref$1 = require("./dom");
var domIndex = ref$1.domIndex;

var observeOptions = {childList: true, characterData: true, attributes: true, subtree: true}
// IE11 has very broken mutation observers, so we also listen to DOMCharacterDataModified
var useCharData = browser.ie && browser.ie_version <= 11

var DOMObserver = function(view) {
  var this$1 = this;

  this.view = view
  this.observer = window.MutationObserver &&
    new window.MutationObserver(function (mutations) { return this$1.registerMutations(mutations); })
  if (useCharData)
    { this.onCharData = function (e) { return this$1.registerMutation({target: e.target, type: "characterData"}); } }
};

DOMObserver.prototype.start = function () {
  if (this.observer)
    { this.observer.observe(this.view.dom, observeOptions) }
  if (useCharData)
    { this.view.dom.addEventListener("DOMCharacterDataModified", this.onCharData) }
};

DOMObserver.prototype.stop = function () {
  if (this.observer) {
    this.flush()
    this.observer.disconnect()
  }
  if (useCharData)
    { this.view.dom.removeEventListener("DOMCharacterDataModified", this.onCharData) }
};

DOMObserver.prototype.flush = function () {
  if (this.observer)
    { this.registerMutations(this.observer.takeRecords()) }
};

DOMObserver.prototype.registerMutations = function (mutations) {
    var this$1 = this;

  for (var i = 0; i < mutations.length; i++)
    { this$1.registerMutation(mutations[i]) }
};

DOMObserver.prototype.registerMutation = function (mut) {
  if (!this.view.editable) { return }
  var desc = this.view.docView.nearestDesc(mut.target)
  if (mut.type == "attributes" &&
      (desc == this.view.docView || mut.attributeName == "contenteditable")) { return }
  if (!desc || desc.ignoreMutation(mut)) { return }

  var from, to
  if (mut.type == "childList") {
    var fromOffset = mut.previousSibling && mut.previousSibling.parentNode == mut.target
        ? domIndex(mut.previousSibling) + 1 : 0
    if (fromOffset == -1) { return }
    from = desc.localPosFromDOM(mut.target, fromOffset, -1)
    var toOffset = mut.nextSibling && mut.nextSibling.parentNode == mut.target
        ? domIndex(mut.nextSibling) : mut.target.childNodes.length
    if (toOffset == -1) { return }
    to = desc.localPosFromDOM(mut.target, toOffset, 1)
  } else if (mut.type == "attributes") {
    from = desc.posAtStart - desc.border
    to = desc.posAtEnd + desc.border
  } else { // "characterData"
    from = desc.posAtStart
    to = desc.posAtEnd
  }

  DOMChange.start(this.view).addRange(from, to)
};
exports.DOMObserver = DOMObserver
