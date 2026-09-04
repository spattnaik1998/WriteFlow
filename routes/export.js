const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const axios = require('axios');
const supabase = require('../services/supabase');
const { htmlToBlocks } = require('../services/noteHtml');
const { sortNotesByChapter, sortChapterNames } = require('../services/chapterOrder');

// Real margins, rather than `margin: 0` plus manual positioning: pdfkit uses them to
// decide where a paragraph breaks across pages, so with a zero bottom margin long notes
// flow straight over the footer and off the sheet.
const MARGINS = { top: 60, bottom: 70, left: 60, right: 60 };
const REMOTE_IMAGE_TIMEOUT_MS = 5000;
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;

// Pasted screenshots arrive as data: URIs, but notes pasted off a web page can carry
// <img src="https://...">. Resolve those up front so a slow or dead host fails while the
// response is still a plain JSON error, not half a PDF.
async function resolveRemoteImages(blocks) {
  for (const block of blocks) {
    if (block.type !== 'image' || block.data || !block.url) continue;
    try {
      const response = await axios.get(block.url, {
        responseType: 'arraybuffer',
        timeout: REMOTE_IMAGE_TIMEOUT_MS,
        maxContentLength: MAX_REMOTE_IMAGE_BYTES,
        maxRedirects: 3
      });
      block.data = Buffer.from(response.data);
      block.mime = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
    } catch (error) {
      block.error = `Linked image could not be downloaded (${error.message})`;
    }
  }
  return blocks;
}

function layoutFor(doc, top) {
  return {
    left: MARGINS.left,
    width: doc.page.width - MARGINS.left - MARGINS.right,
    top,
    bottom: doc.page.height - MARGINS.bottom
  };
}

// Usable height of a *fresh* page — the ceiling for scaling an image, and the cap on how
// much room it is worth demanding before a block starts.
function pageCapacity(layout) {
  return layout.bottom - MARGINS.top;
}

function ensureRoom(doc, layout, needed) {
  if (doc.y + Math.min(needed, pageCapacity(layout)) > layout.bottom) {
    doc.addPage();
    doc.y = MARGINS.top;
  }
}

function renderImagePlaceholder(doc, layout, message) {
  ensureRoom(doc, layout, 46);
  const top = doc.y;
  doc.roundedRect(layout.left, top, layout.width, 38, 4).fill('#f7f7f7');
  doc.roundedRect(layout.left, top, layout.width, 38, 4)
    .strokeColor('#e0e0e0').lineWidth(0.5).stroke();
  doc.fontSize(9).font('Helvetica-Oblique').fillColor('#999999');
  doc.text(message, layout.left + 12, top + 14, {
    width: layout.width - 24,
    lineBreak: false,
    ellipsis: true
  });
  doc.y = top + 48;
}

function renderImageBlock(doc, block, layout) {
  const caption = String(block.alt || '').trim();

  if (block.data && block.data.length) {
    // openImage parses the header only — it validates the format and hands back the pixel
    // dimensions needed to scale and paginate before anything is written to the page.
    let image = null;
    try {
      image = doc.openImage(block.data);
    } catch (_error) {
      image = null;
    }

    if (image && image.width && image.height) {
      const scale = Math.min(layout.width / image.width, pageCapacity(layout) / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;

      ensureRoom(doc, layout, height + 8);
      const top = doc.y;
      try {
        doc.image(image, layout.left, top, { width, height });
        doc.rect(layout.left, top, width, height)
          .strokeColor('#e0e0e0').lineWidth(0.5).stroke();
        doc.y = top + height + 6;
        if (caption) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor('#888888');
          doc.text(caption, layout.left, doc.y, { width: layout.width });
        }
        doc.moveDown(0.6);
        return;
      } catch (error) {
        // Formats pdfkit opens but cannot embed (interlaced PNG, exotic bit depths).
        doc.y = top;
        renderImagePlaceholder(doc, layout, `Image could not be embedded (${error.message})`);
        return;
      }
    }
  }

  renderImagePlaceholder(
    doc,
    layout,
    block.error ||
      `Image omitted — ${block.mime || 'this format'} cannot be embedded (PDF export supports PNG and JPEG)`
  );
}

function renderNoteBlocks(doc, blocks, layout) {
  blocks.forEach(block => {
    if (block.type === 'image') {
      renderImageBlock(doc, block, layout);
      return;
    }

    if (block.type === 'rule') {
      ensureRoom(doc, layout, 16);
      doc.strokeColor('#e0e0e0').lineWidth(0.5);
      doc.moveTo(layout.left, doc.y + 6).lineTo(layout.left + layout.width, doc.y + 6).stroke();
      doc.y += 16;
      return;
    }

    if (block.type === 'heading') {
      doc.fontSize(block.level <= 2 ? 15 : 13).font('Helvetica-Bold').fillColor('#2c5aa0');
      ensureRoom(doc, layout, doc.heightOfString(block.text, { width: layout.width }) + 10);
      doc.text(block.text, layout.left, doc.y, { width: layout.width });
      doc.moveDown(0.35);
      return;
    }

    if (block.type === 'quote') {
      doc.fontSize(11).font('Helvetica-Oblique').fillColor('#555555');
      const textWidth = layout.width - 18;
      ensureRoom(doc, layout, doc.heightOfString(block.text, { width: textWidth, lineGap: 3 }) + 8);
      const top = doc.y;
      doc.text(block.text, layout.left + 18, top, { width: textWidth, lineGap: 3 });
      // Skip the rule if the quote flowed onto a new page — top no longer sits above doc.y.
      if (doc.y > top) {
        doc.strokeColor('#c9a84c').lineWidth(2);
        doc.moveTo(layout.left + 4, top).lineTo(layout.left + 4, doc.y).stroke();
      }
      doc.moveDown(0.5);
      return;
    }

    if (block.type === 'bullet') {
      doc.fontSize(11).font('Helvetica').fillColor('#1a1a1a');
      const textWidth = layout.width - 20;
      ensureRoom(doc, layout, doc.heightOfString(block.text, { width: textWidth, lineGap: 3 }) + 6);
      const top = doc.y;
      doc.circle(layout.left + 4, top + 5, 2).fill('#2c5aa0');
      doc.fillColor('#1a1a1a');
      doc.text(block.text, layout.left + 20, top, { width: textWidth, lineGap: 3 });
      doc.moveDown(0.35);
      return;
    }

    doc.fontSize(11).font('Helvetica').fillColor('#1a1a1a');
    ensureRoom(doc, layout, doc.heightOfString(block.text, { width: layout.width, lineGap: 3 }));
    doc.text(block.text, layout.left, doc.y, { width: layout.width, align: 'left', lineGap: 3 });
    doc.moveDown(0.5);
  });
}

// POST /api/export/notes-pdf — generate PDF of all notes for a book
router.post('/notes-pdf', async (req, res) => {
  const { book_id } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  try {
    // Fetch the book
    const { data: bookData, error: bookError } = await supabase
      .from('books')
      .select('*')
      .eq('id', book_id)
      .single();

    if (bookError || !bookData) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Fetch all notes for the book. chapter_order is NULL on every row in practice — the
    // editor never posts it — so this ORDER BY is only a stable starting point; reading
    // order is settled by sortNotesByChapter below.
    const { data: rawNotes, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('book_id', book_id)
      .order('chapter_order', { ascending: true });

    if (notesError) {
      return res.status(500).json({ error: notesError.message });
    }

    const notesData = sortNotesByChapter(rawNotes);

    // Notes are stored as contenteditable HTML, so parse each one into blocks and resolve
    // any linked images BEFORE the response stream opens — once doc.pipe(res) runs the
    // status code is committed and a failed fetch can no longer be reported as JSON.
    const blocksByNote = new Map();
    for (const note of notesData || []) {
      const blocks = htmlToBlocks(note.content);
      await resolveRemoteImages(blocks);
      blocksByNote.set(note.id, blocks);
    }

    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      margins: { ...MARGINS },
      bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${bookData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_notes.pdf"`);

    doc.pipe(res);

    // ═══════════════════════════════════════
    // TITLE PAGE
    // ═══════════════════════════════════════
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // Gradient-like background effect with colored header
    doc.rect(0, 0, pageWidth, 200).fillAndStroke('#2c5aa0', '#1a3a6f');

    // Title
    doc.fontSize(48).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text(bookData.title, 60, 50, {
      width: pageWidth - 120,
      align: 'left'
    });

    // Author
    doc.moveDown(2);
    doc.fontSize(20).font('Helvetica').fillColor('#e0e0e0');
    doc.text(bookData.author || 'Unknown Author', 60, doc.y, {
      width: pageWidth - 120
    });

    // Content section
    doc.moveDown(4);
    doc.fontSize(12).font('Helvetica').fillColor('#1a1a1a');
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.text(`Compiled: ${today}`, 60, doc.y);
    doc.text(`Total Chapters: ${notesData ? notesData.length : 0}`, 60, doc.y + 20);

    // ═══════════════════════════════════════
    // CONTENT PAGES
    // ═══════════════════════════════════════
    if (notesData && notesData.length > 0) {
      notesData.forEach(note => {
        // Add new page for each chapter
        doc.addPage();

        // Chapter header with background. Shrink the title until it fits the band rather
        // than letting a long chapter name wrap out of it.
        doc.rect(0, 0, pageWidth, 50).fill('#f5f5f5');
        const chapterName = note.chapter_name || 'Untitled chapter';
        doc.font('Helvetica-Bold');
        let titleSize = 22;
        while (titleSize > 12 && doc.fontSize(titleSize).widthOfString(chapterName) > pageWidth - 120) {
          titleSize -= 1;
        }
        doc.fontSize(titleSize).fillColor('#2c5aa0');
        doc.text(chapterName, 60, (50 - titleSize) / 2, {
          width: pageWidth - 120,
          lineBreak: false,
          ellipsis: true
        });

        // Separator line
        doc.strokeColor('#d0d0d0').lineWidth(1);
        doc.moveTo(60, 50).lineTo(pageWidth - 60, 50).stroke();

        // Chapter metadata
        doc.fontSize(9).font('Helvetica').fillColor('#888888');
        const updatedDate = note.updated_at
          ? new Date(note.updated_at).toLocaleDateString()
          : 'N/A';
        doc.text(`Last updated: ${updatedDate}`, 60, 62, { width: pageWidth - 120 });

        const layout = layoutFor(doc, 88);
        doc.y = layout.top;

        const blocks = blocksByNote.get(note.id) || [];
        if (blocks.length > 0) {
          renderNoteBlocks(doc, blocks, layout);
        } else {
          doc.fontSize(11).font('Helvetica-Oblique').fillColor('#999999');
          doc.text('No notes recorded for this chapter.', layout.left, doc.y, { width: layout.width });
        }
      });
    } else {
      doc.addPage();
      doc.fontSize(16).fillColor('#999999');
      doc.text('No notes found for this book.', { align: 'center' });
    }

    // ═══════════════════════════════════════
    // ADD PAGE NUMBERS AND FOOTERS
    // ═══════════════════════════════════════
    const totalPages = doc.bufferedPageRange().count;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      // The footer deliberately sits below the text margin. Drop that margin first, or
      // pdfkit treats writing there as an overflow and appends a blank page.
      doc.page.margins.bottom = 0;

      // Footer separator line
      doc.strokeColor('#e0e0e0').lineWidth(0.5);
      doc.moveTo(60, pageHeight - 50).lineTo(pageWidth - 60, pageHeight - 50).stroke();

      // Page number and document info
      doc.fontSize(9).font('Helvetica').fillColor('#999999');
      doc.text(
        `${i > 0 ? bookData.title + ' • ' : ''}Page ${i + 1} of ${totalPages}`,
        60,
        pageHeight - 40,
        { width: pageWidth - 120, align: 'center', lineBreak: false }
      );
    }

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    // Once the PDF stream is open the status line is already sent; all that is left is to
    // stop writing rather than crash on "headers already sent".
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Failed to generate PDF', details: error.message });
  }
});

// POST /api/export/ideas-pdf — generate PDF of all idea cards for a book
router.post('/ideas-pdf', async (req, res) => {
  const { book_id } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  try {
    const { data: bookData, error: bookError } = await supabase
      .from('books')
      .select('*')
      .eq('id', book_id)
      .single();

    if (bookError || !bookData) return res.status(404).json({ error: 'Book not found' });

    const { data: ideasData, error: ideasError } = await supabase
      .from('ideas')
      .select('*')
      .eq('book_id', book_id)
      .order('number', { ascending: true });

    if (ideasError) return res.status(500).json({ error: ideasError.message });

    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${bookData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_ideas.pdf"`);
    doc.pipe(res);

    const pageWidth  = doc.page.width;
    const pageHeight = doc.page.height;
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // ── Cover page ──────────────────────────────────────────────────────────
    doc.rect(0, 0, pageWidth, 200).fillAndStroke('#2c5aa0', '#1a3a6f');

    doc.fontSize(42).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text(bookData.title, 60, 48, { width: pageWidth - 120, align: 'left' });

    doc.fontSize(18).font('Helvetica').fillColor('#e0e0e0');
    doc.text(bookData.author || 'Unknown Author', 60, doc.y + 4, { width: pageWidth - 120 });

    doc.moveDown(3);
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#c9a84c');
    doc.text('IDEA CARDS', 60, doc.y, { width: pageWidth - 120 });

    doc.moveDown(1.2);
    doc.fontSize(11).font('Helvetica').fillColor('#444444');
    doc.text(`Compiled: ${today}`, 60, doc.y);
    doc.text(`Total cards: ${ideasData ? ideasData.length : 0}`, 60, doc.y + 16);

    // ── Group ideas by chapter_name, then put the groups in reading order ───
    const chapterMap = {};
    if (ideasData) {
      ideasData.forEach(idea => {
        const ch = idea.chapter_name || 'General';
        if (!chapterMap[ch]) chapterMap[ch] = [];
        chapterMap[ch].push(idea);
      });
    }
    const chapters = sortChapterNames(Object.keys(chapterMap));

    // ── Content pages ───────────────────────────────────────────────────────
    const LEFT = 60;
    const CONTENT_WIDTH = pageWidth - 120;
    const BOTTOM_MARGIN = 60;

    chapters.forEach(chapterName => {
      doc.addPage();

      // Chapter header band
      doc.rect(0, 0, pageWidth, 46).fill('#f5f5f5');
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#2c5aa0');
      doc.text(chapterName, LEFT, 13, { width: CONTENT_WIDTH });

      doc.strokeColor('#d0d0d0').lineWidth(1);
      doc.moveTo(LEFT, 46).lineTo(pageWidth - LEFT, 46).stroke();

      doc.y = 62;

      chapterMap[chapterName].forEach((idea, idx) => {
        const cardNum = String(idea.number || idx + 1).padStart(2, '0');

        // Estimate height needed: title + body + tags + spacing
        const bodyHeight = doc.heightOfString(idea.body || '', { width: CONTENT_WIDTH - 24, fontSize: 11 });
        const cardHeight = 16 + 20 + 8 + bodyHeight + 28 + 24;

        if (doc.y + cardHeight > pageHeight - BOTTOM_MARGIN) {
          doc.addPage();
          doc.y = 24;
        }

        const cardTop = doc.y;

        // Card background
        doc.roundedRect(LEFT, cardTop, CONTENT_WIDTH, cardHeight, 6).fill('#fafafa');
        doc.roundedRect(LEFT, cardTop, CONTENT_WIDTH, cardHeight, 6)
          .strokeColor('#e0e0e0').lineWidth(0.5).stroke();

        // Insight number badge
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#999999');
        doc.text(`INSIGHT ${cardNum}`, LEFT + 12, cardTop + 10, { width: CONTENT_WIDTH - 24 });

        // Title
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a');
        doc.text(idea.title || 'Untitled', LEFT + 12, cardTop + 22, { width: CONTENT_WIDTH - 24 });

        // Body
        const bodyY = cardTop + 22 + doc.heightOfString(idea.title || 'Untitled', { width: CONTENT_WIDTH - 24, fontSize: 14 }) + 6;
        doc.fontSize(11).font('Helvetica').fillColor('#333333');
        doc.text(idea.body || '', LEFT + 12, bodyY, { width: CONTENT_WIDTH - 24, lineGap: 2 });

        // Tags
        if (idea.tags && idea.tags.length > 0) {
          const tagsY = bodyY + doc.heightOfString(idea.body || '', { width: CONTENT_WIDTH - 24, fontSize: 11 }) + 8;
          let tagX = LEFT + 12;
          const tags = Array.isArray(idea.tags) ? idea.tags : String(idea.tags).split(',').map(t => t.trim());
          tags.forEach(tag => {
            if (!tag) return;
            const label = tag.toUpperCase();
            const tagW = doc.widthOfString(label, { fontSize: 8 }) + 12;
            doc.roundedRect(tagX, tagsY, tagW, 14, 3).fill('#e8e8e8');
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#666666');
            doc.text(label, tagX + 6, tagsY + 3, { width: tagW - 12, lineBreak: false });
            tagX += tagW + 6;
          });
        }

        doc.y = cardTop + cardHeight + 14;
      });
    });

    if (!ideasData || ideasData.length === 0) {
      doc.addPage();
      doc.fontSize(14).fillColor('#999999').font('Helvetica');
      doc.text('No idea cards found for this book.', { align: 'center' });
    }

    // ── Page numbers ────────────────────────────────────────────────────────
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.strokeColor('#e0e0e0').lineWidth(0.5);
      doc.moveTo(LEFT, pageHeight - 50).lineTo(pageWidth - LEFT, pageHeight - 50).stroke();
      doc.fontSize(9).font('Helvetica').fillColor('#999999');
      doc.text(
        `${i > 0 ? bookData.title + ' • ' : ''}Page ${i + 1} of ${totalPages}`,
        LEFT, pageHeight - 40, { width: CONTENT_WIDTH, align: 'center' }
      );
    }

    doc.end();
  } catch (error) {
    console.error('Ideas PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF', details: error.message });
  }
});

module.exports = router;
