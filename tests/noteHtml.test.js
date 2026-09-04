const assert = require('assert');
const { htmlToBlocks, plainTextToBlocks, noteToPlainText } = require('../services/noteHtml');

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

// ── noteToPlainText: what every LLM prompt, excerpt and word count now uses ──────────

const SCREENSHOT = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUg'.repeat(4000);

function testPromptTextNeverCarriesBase64() {
  // The whole point: an image's payload is billed, unreadable to a text prompt, and
  // crowds the real notes out of any prompt with a character budget.
  const html = `<div>Before the graph.</div><div><img src="${SCREENSHOT}" alt="Revenue"></div><div>After it.</div>`;
  const text = noteToPlainText(html);

  assert.ok(!text.includes('base64'), 'no data URI may survive');
  assert.ok(!text.includes('iVBORw0KGgo'), 'no payload may survive');
  assert.ok(text.length < 200, `expected a short summary, got ${text.length} chars`);
  assert.strictEqual(text, ['Before the graph.', '[image: Revenue]', 'After it.'].join('\n'));
}

function testImagesLeaveAMarkerSoTheModelKnowsOneWasThere() {
  assert.strictEqual(noteToPlainText('<div><img src="data:image/png;base64,iVBORw0KGgo="></div>'), '[image]');
  assert.strictEqual(
    noteToPlainText('<div><img src="data:image/png;base64,iVBORw0KGgo=" alt="Chart 3"></div>'),
    '[image: Chart 3]'
  );
  assert.strictEqual(noteToPlainText('<div>Text</div><div><img src="x.png"></div>', { imageMarker: false }), 'Text');
}

function testMarkupIsStrippedButStructureSurvives() {
  const text = noteToPlainText(
    '<h2>Argument</h2><div>The <b>core</b> claim.</div><ul><li>First</li><li>Second</li></ul>'
  );
  assert.strictEqual(text, ['Argument', 'The core claim.', '- First', '- Second'].join('\n'));
}

function testEntitiesAreReadableInPrompts() {
  assert.strictEqual(noteToPlainText('<div>Ideas&nbsp;&amp;&nbsp;consequences &mdash; both</div>'),
    'Ideas & consequences — both');
}

function testAnImageOnlyNoteIsNotMistakenForAnEmptyOne() {
  // Callers filter on the returned text; a chapter that is only a screenshot should
  // still register as having content.
  assert.ok(noteToPlainText(`<div><img src="${SCREENSHOT}"></div>`).trim().length > 0);
}

function testEmptyAndMissingContentProduceEmptyText() {
  assert.strictEqual(noteToPlainText(''), '');
  assert.strictEqual(noteToPlainText(null), '');
  assert.strictEqual(noteToPlainText(undefined), '');
  assert.strictEqual(noteToPlainText('<div></div><br>'), '');
}

function testLegacyPlainTextNotesSurviveUnchanged() {
  // Older notes were stored as plain text, not HTML — they must pass through intact.
  assert.strictEqual(noteToPlainText('A plain sentence about well-being.'),
    'A plain sentence about well-being.');
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

testPromptTextNeverCarriesBase64();
testImagesLeaveAMarkerSoTheModelKnowsOneWasThere();
testMarkupIsStrippedButStructureSurvives();
testEntitiesAreReadableInPrompts();
testAnImageOnlyNoteIsNotMistakenForAnEmptyOne();
testEmptyAndMissingContentProduceEmptyText();
testLegacyPlainTextNotesSurviveUnchanged();

console.log('noteHtml tests passed');
