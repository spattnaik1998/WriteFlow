const express = require('express');
const router = express.Router();
const { createEssaySession, loadSession, saveSession, runEssayAgentTurn, resolveDraftProposal, reviseDraftProposal } = require('../services/essayAgent');
const { parseUploadedDocument } = require('../services/documentParser');
const { listWritingBackends } = require('../services/llmClient');

router.get('/options', async (_req, res) => {
  try {
    const backends = await listWritingBackends();
    res.json({
      backends,
      audiences: [
        'LinkedIn audience',
        'Research scientists',
        'Product leaders',
        'Business leaders',
        'Founders and operators',
        'Technical generalists'
      ],
      tones: [
        'Professional',
        'Analytical',
        'Research-forward',
        'Essayistic',
        'Strategic',
        'Contrarian but precise'
      ]
    });
  } catch (error) {
    console.error('[essay-agent/options] failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/ingest-docs', async (req, res) => {
  const { files = [] } = req.body || {};
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files required' });
  }

  try {
    const parsed = [];
    for (const file of files) {
      const doc = await parseUploadedDocument({
        name: file.name,
        mimeType: file.mime_type,
        base64: file.base64
      });
      parsed.push({
        id: file.id || null,
        title: doc.title,
        mime_type: doc.mime_type,
        source: 'file upload',
        content: doc.content
      });
    }
    res.json({ documents: parsed });
  } catch (error) {
    console.error('[essay-agent/ingest-docs] failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/session', async (req, res) => {
  const {
    topic,
    audience,
    tone,
    backend,
    model,
    book_ids = [],
    uploaded_docs = []
  } = req.body || {};

  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'topic required' });
  }

  try {
    const session = await createEssaySession({
      topic: String(topic).trim(),
      audience: String(audience || '').trim(),
      tone: String(tone || '').trim(),
      backend: String(backend || '').trim(),
      model: String(model || '').trim(),
      bookIds: Array.isArray(book_ids) ? book_ids.filter(Boolean) : [],
      uploadedDocs: Array.isArray(uploaded_docs) ? uploaded_docs : []
    });

    res.status(201).json({
      id: session.id,
      created_at: session.created_at,
      backend: session.backend,
      model: session.model,
      topic: session.topic,
      selected_books: session.selected_books,
      uploaded_docs: session.uploaded_docs.map(doc => ({
        id: doc.id,
        title: doc.title,
        source: doc.source,
        mime_type: doc.mime_type
      })),
      memory: session.memory,
      draft_markdown: session.draft_markdown,
      transcript: session.transcript,
      last_tool_trace: session.last_tool_trace || [],
      last_plan: session.last_plan || null,
      last_evidence_packet: session.last_evidence_packet || null,
      pending_draft_updates: session.pending_draft_updates || []
    });
  } catch (error) {
    console.error('[essay-agent/session] create failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.get('/session/:id', async (req, res) => {
  try {
    const session = await loadSession(req.params.id);
    res.json({
      id: session.id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      topic: session.topic,
      audience: session.audience,
      tone: session.tone,
      backend: session.backend,
      model: session.model,
      selected_books: session.selected_books,
      uploaded_docs: session.uploaded_docs.map(doc => ({
        id: doc.id,
        title: doc.title,
        source: doc.source,
        mime_type: doc.mime_type
      })),
      memory: session.memory,
      draft_markdown: session.draft_markdown,
      transcript: session.transcript,
      last_tool_trace: session.last_tool_trace || [],
      last_plan: session.last_plan || null,
      last_evidence_packet: session.last_evidence_packet || null,
      pending_draft_updates: session.pending_draft_updates || []
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Session not found' });
    }
    console.error('[essay-agent/session] load failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/session/:id/message', async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  try {
    const session = await loadSession(req.params.id);
    const result = await runEssayAgentTurn(session, String(message).trim());
    res.json({
      id: result.session.id,
      assistant_message: result.assistant_message,
      draft_markdown: result.draft_markdown,
      memory: result.memory,
      pending_draft_updates: result.pending_draft_updates,
      transcript: result.session.transcript,
      tool_trace: result.tool_trace,
      plan: result.plan,
      evidence_packet: result.evidence_packet,
      tool_registry: result.session.tool_registry || {},
      critique: result.critique || null,
      loop_intervention_fired: result.loop_intervention_fired || false,
      memory_compacted: result.memory_compacted || false,
      backend: result.backend,
      model: result.model,
      fallback_reason: result.fallback_reason
    });
  } catch (error) {
    console.error('[essay-agent/session] turn failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/session/:id/proposals/:proposalId', async (req, res) => {
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!['accept', 'reject', 'revise'].includes(action)) {
    return res.status(400).json({ error: 'action must be accept, reject, or revise' });
  }
  if (action === 'revise' && !String(req.body?.feedback || '').trim()) {
    return res.status(400).json({ error: 'feedback is required when action is revise' });
  }

  try {
    const session = await loadSession(req.params.id);
    const updated = action === 'revise'
      ? await reviseDraftProposal(session, req.params.proposalId, String(req.body?.feedback || ''))
      : await resolveDraftProposal(session, req.params.proposalId, action);
    res.json({
      id: updated.id,
      draft_markdown: updated.draft_markdown,
      memory: updated.memory,
      transcript: updated.transcript,
      pending_draft_updates: updated.pending_draft_updates || []
    });
  } catch (error) {
    console.error('[essay-agent/proposals] resolve failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /session/:id/docs — attach supporting documents to an ACTIVE session so the harness
// can integrate ancillary material (papers, PDFs, pasted text) mid-conversation.
router.post('/session/:id/docs', async (req, res) => {
  const { files = [], paste = null } = req.body || {};
  let session;
  try {
    session = await loadSession(req.params.id);
  } catch (err) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const newDocs = [];

  for (const file of files) {
    try {
      const doc = await parseUploadedDocument({ name: file.name, mimeType: file.mime_type, base64: file.base64 });
      newDocs.push({
        id: file.id || `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        title: doc.title,
        mime_type: doc.mime_type,
        source: 'file upload',
        content: doc.content
      });
    } catch (err) {
      return res.status(422).json({ error: `Could not parse ${file.name}: ${err.message}` });
    }
  }

  if (paste && String(paste.content || '').trim()) {
    newDocs.push({
      id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: String(paste.title || 'Pasted document').trim(),
      mime_type: 'text/plain',
      source: 'pasted text',
      content: String(paste.content).slice(0, 30000)
    });
  }

  if (!newDocs.length) return res.status(400).json({ error: 'No documents provided' });

  session.uploaded_docs = [...(session.uploaded_docs || []), ...newDocs];

  // Update memory so the planner knows about the new sources on the next turn.
  const newTitles = newDocs.map(d => `Document: ${d.title}`);
  const newFindings = newDocs.map(d => `New document added mid-session: "${d.title}"`);
  session.memory = session.memory || {};
  session.memory.source_ledger = [...new Set([...(session.memory.source_ledger || []), ...newTitles])].slice(0, 16);
  session.memory.recent_findings = [...new Set([...(session.memory.recent_findings || []), ...newFindings])].slice(0, 8);

  try {
    await saveSession(session);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save session: ' + err.message });
  }

  res.json({
    added: newDocs.map(d => ({ id: d.id, title: d.title, source: d.source, mime_type: d.mime_type })),
    total_docs: session.uploaded_docs.length
  });
});

module.exports = router;
