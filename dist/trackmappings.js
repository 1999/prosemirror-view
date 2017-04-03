var ref = require("prosemirror-state");
var EditorState = ref.EditorState;
var ref$1 = require("prosemirror-transform");
var Mapping = ref$1.Mapping;

var TrackedRecord = function(prev, mapping, state) {
  this.prev = prev
  this.mapping = mapping
  this.state = state
};

var TrackMappings = function(state) {
  this.seen = [new TrackedRecord(null, null, state)]
  // Kludge to listen to state changes globally in order to be able
  // to find mappings from a given state to another.
  EditorState.addApplyListener(this.track = this.track.bind(this))
};

TrackMappings.prototype.destroy = function () {
  EditorState.removeApplyListener(this.track)
};

TrackMappings.prototype.find = function (state) {
    var this$1 = this;

  for (var i = this.seen.length - 1; i >= 0; i--) {
    var record = this$1.seen[i]
    if (record.state == state) { return record }
  }
};

TrackMappings.prototype.track = function (old, tr, state) {
  var found = this.seen.length < 200 ? this.find(old) : null
  if (found)
    { this.seen.push(new TrackedRecord(found, tr.docChanged ? tr.mapping : null, state)) }
};

TrackMappings.prototype.getMapping = function (state, appendTo) {
  var found = this.find(state)
  if (!found) { return null }
  var mappings = []
  for (var rec = found; rec; rec = rec.prev)
    { if (rec.mapping) { mappings.push(rec.mapping) } }
  var result = appendTo || new Mapping
  for (var i = mappings.length - 1; i >= 0; i--)
    { result.appendMapping(mappings[i]) }
  return result
};
exports.TrackMappings = TrackMappings
