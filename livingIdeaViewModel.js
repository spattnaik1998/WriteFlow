(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WriteFlowLivingIdeaView = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function htmlEscape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function textOf(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return value.text || value.summary || value.name || value.claim || JSON.stringify(value);
  }

  function linesFromList(value) {
    return asArray(value).map(textOf).map(item => item.trim()).filter(Boolean).join('\n');
  }

  function listFromLines(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function evidenceFromLines(value) {
    return listFromLines(value).map(text => ({ text, source: '' }));
  }

  function statusLabel(livingIdea) {
    const state = livingIdea?.mastery?.state || 'new';
    const score = Number(livingIdea?.mastery?.score || 0);
    return `${state.replace(/_/g, ' ')} / ${Math.round(score)}%`;
  }

  function fallbackFromIdeaCard(card = {}) {
    return {
      id: '',
      idea_id: card.ideaId || card.id || '',
      claim: card.title || '',
      definition: card.body || '',
      mechanism: '',
      evidence: [],
      examples: [],
      boundary_conditions: [],
      counterarguments: [],
      open_questions: [],
      compressed_principle: card.title || '',
      source_fragments: [],
      connection_summary: '',
      mastery: { state: 'new', score: 0 },
      ideas: {
        title: card.title || 'Untitled idea',
        body: card.body || '',
        tags: card.tags || []
      },
      isFallback: true
    };
  }

  function titleFor(livingIdea, card = {}) {
    return livingIdea?.ideas?.title || card.title || livingIdea?.claim || 'Untitled idea';
  }

  function bodyFor(livingIdea, card = {}) {
    return livingIdea?.ideas?.body || card.body || livingIdea?.definition || '';
  }

  function tagsFor(livingIdea, card = {}) {
    return livingIdea?.ideas?.tags || card.tags || [];
  }

  function renderPillList(items, emptyText) {
    const values = asArray(items).map(textOf).filter(Boolean);
    if (!values.length) return `<div class="living-detail-empty">${htmlEscape(emptyText)}</div>`;
    return `<div class="living-detail-pill-row">${values.map(item => `<span class="living-detail-pill">${htmlEscape(item)}</span>`).join('')}</div>`;
  }

  function renderReadOnly(livingIdea, card = {}) {
    const title = titleFor(livingIdea, card);
    const tags = tagsFor(livingIdea, card);
    const body = bodyFor(livingIdea, card);
    const fallbackNotice = livingIdea?.isFallback
      ? '<div class="living-detail-notice">This older card does not have a living idea record yet. New chapter distillations will create one automatically.</div>'
      : '';

    return `
      ${fallbackNotice}
      <div class="living-detail-hero">
        <div>
          <div class="living-detail-kicker">Living Idea</div>
          <div class="living-detail-title">${htmlEscape(title)}</div>
          <div class="living-detail-sub">${htmlEscape(body)}</div>
        </div>
        <div class="living-detail-mastery">${htmlEscape(statusLabel(livingIdea))}</div>
      </div>
      <div class="living-detail-tags">${renderPillList(tags, 'No tags yet.')}</div>
      <div class="living-detail-grid">
        <section><label>Claim</label><p>${htmlEscape(livingIdea.claim)}</p></section>
        <section><label>Definition</label><p>${htmlEscape(livingIdea.definition)}</p></section>
        <section><label>Mechanism</label><p>${htmlEscape(livingIdea.mechanism || 'No mechanism captured yet.')}</p></section>
        <section><label>Compressed Principle</label><p>${htmlEscape(livingIdea.compressed_principle || 'No principle captured yet.')}</p></section>
        <section><label>Evidence</label>${renderPillList(livingIdea.evidence, 'No evidence captured yet.')}</section>
        <section><label>Examples</label>${renderPillList(livingIdea.examples, 'No examples captured yet.')}</section>
        <section><label>Boundary Conditions</label>${renderPillList(livingIdea.boundary_conditions, 'No boundaries captured yet.')}</section>
        <section><label>Counterarguments</label>${renderPillList(livingIdea.counterarguments, 'No counterarguments captured yet.')}</section>
        <section><label>Open Questions</label>${renderPillList(livingIdea.open_questions, 'No open questions captured yet.')}</section>
        <section><label>Connection Summary</label><p>${htmlEscape(livingIdea.connection_summary || 'No cross-library connection summary yet.')}</p></section>
      </div>
    `;
  }

  function renderEditForm(livingIdea) {
    return `
      <div class="living-detail-form">
        <label>Claim<textarea data-field="claim">${htmlEscape(livingIdea.claim)}</textarea></label>
        <label>Definition<textarea data-field="definition">${htmlEscape(livingIdea.definition)}</textarea></label>
        <label>Mechanism<textarea data-field="mechanism">${htmlEscape(livingIdea.mechanism)}</textarea></label>
        <label>Compressed Principle<textarea data-field="compressed_principle">${htmlEscape(livingIdea.compressed_principle)}</textarea></label>
        <label>Evidence<textarea data-field="evidence">${htmlEscape(linesFromList(livingIdea.evidence))}</textarea></label>
        <label>Examples<textarea data-field="examples">${htmlEscape(linesFromList(livingIdea.examples))}</textarea></label>
        <label>Boundary Conditions<textarea data-field="boundary_conditions">${htmlEscape(linesFromList(livingIdea.boundary_conditions))}</textarea></label>
        <label>Counterarguments<textarea data-field="counterarguments">${htmlEscape(linesFromList(livingIdea.counterarguments))}</textarea></label>
        <label>Open Questions<textarea data-field="open_questions">${htmlEscape(linesFromList(livingIdea.open_questions))}</textarea></label>
        <label>Connection Summary<textarea data-field="connection_summary">${htmlEscape(livingIdea.connection_summary)}</textarea></label>
      </div>
    `;
  }

  function parseForm(rootEl) {
    const get = field => rootEl.querySelector(`[data-field="${field}"]`)?.value.trim() || '';
    return {
      claim: get('claim'),
      definition: get('definition'),
      mechanism: get('mechanism'),
      compressed_principle: get('compressed_principle'),
      evidence: evidenceFromLines(get('evidence')),
      examples: listFromLines(get('examples')),
      boundary_conditions: listFromLines(get('boundary_conditions')),
      counterarguments: listFromLines(get('counterarguments')),
      open_questions: listFromLines(get('open_questions')),
      connection_summary: get('connection_summary')
    };
  }

  return {
    fallbackFromIdeaCard,
    htmlEscape,
    linesFromList,
    listFromLines,
    parseForm,
    renderEditForm,
    renderReadOnly,
    statusLabel
  };
});
