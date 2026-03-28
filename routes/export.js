const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const supabase = require('../services/supabase');

// Helper to parse notes by delimiter and format as points
function parseNotePoints(text) {
  if (!text) return [];

  // Split by common delimiters: '-', '•', '*', or newlines followed by '-'
  const points = text
    .split(/[-•*]\s*|\n\s*[-•*]\s*/)
    .map(p => p.trim())
    .filter(p => p && p.length > 3);

  return points;
}

// Helper to add a point with proper formatting and spacing
function addBulletPoint(doc, text, options = {}) {
  const pageHeight = doc.page.height;
  const currentY = doc.y;
  const bottomMargin = 60;

  // If we're too close to the bottom, add a new page
  if (currentY + 50 > pageHeight - bottomMargin) {
    doc.addPage();
    doc.fontSize(options.fontSize || 11).font('Helvetica');
    addHeader(doc);
  }

  const bulletSize = 3;
  const bulletX = 60;
  const textX = 80;
  const maxWidth = doc.page.width - 100;

  // Draw bullet
  doc.fillColor('#2c5aa0');
  doc.circle(bulletX + 2, doc.y + 6, bulletSize);
  doc.fill();

  // Add text
  doc.fontSize(options.fontSize || 11).font('Helvetica').fillColor('#1a1a1a');
  doc.text(text, textX, doc.y, {
    width: maxWidth,
    align: 'left',
    lineGap: 3
  });

  // Add spacing after point
  doc.moveDown(0.4);
}

// Helper to add chapter header
function addHeader(doc) {
  doc.fontSize(9).fillColor('#999999').font('Helvetica');
  const pageNum = doc.bufferedPageRange().count;
  doc.text(
    `Page ${pageNum}`,
    60,
    doc.page.height - 35
  );
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

    // Fetch all notes for the book
    const { data: notesData, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('book_id', book_id)
      .order('chapter_order', { ascending: true });

    if (notesError) {
      return res.status(500).json({ error: notesError.message });
    }

    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
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
      notesData.forEach((note, chapterIndex) => {
        // Add new page for each chapter
        doc.addPage();

        // Chapter header with background
        doc.rect(0, 0, pageWidth, 50).fill('#f5f5f5');
        doc.fontSize(24).font('Helvetica-Bold').fillColor('#2c5aa0');
        doc.text(note.chapter_name, 60, 12, { width: pageWidth - 120 });

        // Separator line
        doc.strokeColor('#d0d0d0').lineWidth(1);
        doc.moveTo(60, 50).lineTo(pageWidth - 60, 50).stroke();

        // Chapter metadata
        doc.moveDown(3.5);
        doc.fontSize(9).font('Helvetica').fillColor('#888888');
        const updatedDate = note.updated_at
          ? new Date(note.updated_at).toLocaleDateString()
          : 'N/A';
        doc.text(`Last updated: ${updatedDate}`);

        doc.moveDown(1);

        // Parse and display points
        const points = parseNotePoints(note.content);

        if (points.length > 0) {
          doc.fontSize(11).font('Helvetica').fillColor('#1a1a1a');

          points.forEach((point, pointIndex) => {
            addBulletPoint(doc, point, { fontSize: 11 });
          });
        } else if (note.content && note.content.trim()) {
          // If no delimiter found, display as is with better formatting
          doc.fontSize(11).font('Helvetica').fillColor('#1a1a1a');
          doc.text(note.content, 60, doc.y, {
            width: doc.page.width - 120,
            align: 'left',
            lineGap: 4
          });
        } else {
          doc.fontSize(11).font('Helvetica').fillColor('#999999').font('Helvetica-Oblique');
          doc.text('No notes recorded for this chapter.', 60, doc.y);
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

      // Footer separator line
      doc.strokeColor('#e0e0e0').lineWidth(0.5);
      doc.moveTo(60, pageHeight - 50).lineTo(pageWidth - 60, pageHeight - 50).stroke();

      // Page number and document info
      doc.fontSize(9).font('Helvetica').fillColor('#999999');
      doc.text(
        `${i > 0 ? bookData.title + ' • ' : ''}Page ${i + 1} of ${totalPages}`,
        60,
        pageHeight - 40,
        { width: pageWidth - 120, align: 'center' }
      );
    }

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
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

    // ── Group ideas by chapter_name ─────────────────────────────────────────
    const chapters = [];
    const chapterMap = {};
    if (ideasData) {
      ideasData.forEach(idea => {
        const ch = idea.chapter_name || 'General';
        if (!chapterMap[ch]) {
          chapterMap[ch] = [];
          chapters.push(ch);
        }
        chapterMap[ch].push(idea);
      });
    }

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
