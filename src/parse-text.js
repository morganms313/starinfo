// Parses MediaInfo's text output into sections for the Tree view.
//
//   General
//   Format                                   : MPEG-4
//   <blank>
//   Audio #1
//   ...
//
// Returns [{ title: 'General', rows: [['Format', 'MPEG-4'], ...] }, ...].
// A line with no " : " separator starts a new section; blank lines end one.
function parseMediaInfoText(text) {
  var sections = [];
  var current = null;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    if (line.trim() === '') { current = null; return; }
    var m = /^(.*?\S)\s+:\s?(.*)$/.exec(line);
    if (!m) {
      current = { title: line.trim(), rows: [] };
      sections.push(current);
      return;
    }
    if (!current) {
      current = { title: '', rows: [] };
      sections.push(current);
    }
    current.rows.push([m[1], m[2]]);
  });
  return sections;
}
