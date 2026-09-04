const assert = require('assert');
const { htmlToBlocks, plainTextToBlocks } = require('../services/noteHtml');

// Smallest valid 1x1 PNG — the shape a pasted screenshot takes once the browser has
// serialised it into the contenteditable.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function testPastedImageBecomesAnImageBlock() {
  const blocks = htmlToBlocks(
    `<div>Before the graph</div><div><img src="data:image/png;base64,${PNG_BASE64}" alt="Bounty curve"></div><div>After the graph</div>`
  );

  assert.deepStrictEqual(blocks.map(b => b.type), ['paragraph', 'image', 'paragraph']);

  const image = blocks[1];
  assert.strictEqual(image.mime, 'image/png');
  assert.strictEqual(image.alt, 'Bounty curve');
  assert.ok(Buffer.isBuffer(image.data), 'image data should be decoded to a Buffer');
  // PNG magic number — proof the base64 was decoded rather than carried as text.
  assert.deepStrictEqual([...image.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
}

function testBase64NeverLeaksIntoTextBlocks() {
  const blocks = htmlToBlocks(
    `<div>Notes</div><img src="data:image/png;base64,${PNG_BASE64}">`
  );

  const text = blocks.filter(b => b.text).map(b => b.text).join(' ');
  assert.doesNotMatch(text, /base64/i);
  assert.doesNotMatch(text, /iVBORw0KGgo/);
  assert.doesNotMatch(text, /<img/i);
}

function testDivAndBrSplitLinesIntoSeparateBlocks() {
  const blocks = htmlToBlocks('<div>First line</div><div>Second line<br>Third line</div>');
  assert.deepStrictEqual(blocks.map(b => b.text), ['First line', 'Second line', 'Third line']);
  assert.ok(blocks.every(b => b.type === 'paragraph'));
}

function testInlineFormattingIsFlattenedNotPrinted() {
  const blocks = htmlToBlocks('<div><b>System 1</b> is <i>fast</i> and <font color="red">automatic</font></div>');
  assert.deepStrictEqual(blocks, [{ type: 'paragraph', text: 'System 1 is fast and automatic' }]);
}

function testEntitiesAndNonBreakingSpacesAreDecoded() {
  const blocks = htmlToBlocks('<div>Kahneman&nbsp;&amp;&nbsp;Tversky &mdash; 17&times;24 &#8212; &quot;fast&quot;</div>');
  assert.strictEqual(blocks[0].text, 'Kahneman & Tversky — 17×24 — "fast"');
}

function testHeadingsListsQuotesAndRules() {
  const blocks = htmlToBlocks(
    '<h2>Chapter thesis</h2><ul><li>First point</li><li>Second point</li></ul>' +
    '<blockquote><div>A quoted passage</div></blockquote><hr>'
  );

  assert.deepStrictEqual(blocks, [
    { type: 'heading', level: 2, text: 'Chapter thesis' },
    { type: 'bullet', text: 'First point' },
    { type: 'bullet', text: 'Second point' },
    { type: 'quote', text: 'A quoted passage' },
    { type: 'rule' }
  ]);
}

function testUnclosedListItemsStillSeparate() {
  // Browsers routinely omit </li>; each new <li> must still close the previous bullet.
  const blocks = htmlToBlocks('<ul><li>Alpha<li>Beta</ul>');
  assert.deepStrictEqual(blocks, [
    { type: 'bullet', text: 'Alpha' },
    { type: 'bullet', text: 'Beta' }
  ]);
}

function testStyleScriptAndCommentsAreDropped() {
  const blocks = htmlToBlocks(
    '<!--StartFragment--><style>p { color: red }</style><div>Real note text</div><!--EndFragment-->'
  );
  assert.deepStrictEqual(blocks, [{ type: 'paragraph', text: 'Real note text' }]);
}

function testUnusableImageSourcesReportAnError() {
  const external = htmlToBlocks('<img src="https://example.com/graph.png" alt="Graph">')[0];
  assert.strictEqual(external.type, 'image');
  assert.strictEqual(external.url, 'https://example.com/graph.png');
  assert.strictEqual(external.data, undefined);

  const blob = htmlToBlocks('<img src="blob:http://localhost/9f2a">')[0];
  assert.strictEqual(blob.type, 'image');
  assert.ok(blob.error, 'a blob: source should be reported as unusable');
}

function testPlainTextNotesKeepHyphenatedWords() {
  // Regression: the old exporter split on any '-', shredding words like "well-being".
  const blocks = plainTextToBlocks('Automation raises well-being for some and not others.');
  assert.deepStrictEqual(blocks, [
    { type: 'paragraph', text: 'Automation raises well-being for some and not others.' }
  ]);
}

function testPlainTextBulletsAreDetectedAtLineStartOnly() {
  const blocks = plainTextToBlocks('Intro line\n- First point\n* Second point\n1. Third point');
  assert.deepStrictEqual(blocks, [
    { type: 'paragraph', text: 'Intro line' },
    { type: 'bullet', text: 'First point' },
    { type: 'bullet', text: 'Second point' },
    { type: 'bullet', text: 'Third point' }
  ]);
}

function testLegacyPlainTextNotesRouteThroughTheTextPath() {
  const blocks = htmlToBlocks('A note saved before the editor became rich text.');
  assert.deepStrictEqual(blocks, [
    { type: 'paragraph', text: 'A note saved before the editor became rich text.' }
  ]);
}

function testEmptyInputProducesNoBlocks() {
  assert.deepStrictEqual(htmlToBlocks(''), []);
  assert.deepStrictEqual(htmlToBlocks(null), []);
  assert.deepStrictEqual(htmlToBlocks('<div></div><br><div>   </div>'), []);
}

testPastedImageBecomesAnImageBlock();
testBase64NeverLeaksIntoTextBlocks();
testDivAndBrSplitLinesIntoSeparateBlocks();
testInlineFormattingIsFlattenedNotPrinted();
testEntitiesAndNonBreakingSpacesAreDecoded();
testHeadingsListsQuotesAndRules();
testUnclosedListItemsStillSeparate();
testStyleScriptAndCommentsAreDropped();
testUnusableImageSourcesReportAnError();
testPlainTextNotesKeepHyphenatedWords();
testPlainTextBulletsAreDetectedAtLineStartOnly();
testLegacyPlainTextNotesRouteThroughTheTextPath();
testEmptyInputProducesNoBlocks();

console.log('noteHtml tests passed');
