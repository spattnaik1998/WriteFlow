const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const supabase = require('../services/supabase');

// Helper to add text with proper word wrapping
function addWrappedText(doc, text, options = {}) {
  if (!text) return;

  const maxWidth = options.width || doc.page.width - 100;
  const fontSize = options.fontSize || 11;
  const lineGap = options.lineGap || 6;

  doc.fontSize(fontSize);
  doc.font('Helvetica');

  const words = text.split(/\s+/);
  let line = '';
  const lines = [];

  for (let word of words) {
    const testLine = line ? line + ' ' + word : word;
    const width = doc.widthOfString(testLine);

    if (width > maxWidth) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);

  lines.forEach(lineText => {
    doc.text(lineText, { width: maxWidth, align: 'left' });
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
      margin: 50,
      bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${bookData.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_notes.pdf"`);

    doc.pipe(res);

    // Title page
    doc.fontSize(32).font('Helvetica-Bold');
    doc.text(bookData.title, { align: 'center' });

    doc.moveDown(1);
    doc.fontSize(16).font('Helvetica');
    doc.text(bookData.author || 'Unknown Author', { align: 'center' });

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.moveDown(2);
    doc.fontSize(12).fillColor('#666666');
    doc.text(`Generated: ${today}`, { align: 'center' });

    doc.moveDown(3);
    doc.fontSize(14).fillColor('#000000').font('Helvetica-Bold');
    doc.text('Chapter Notes', { align: 'center' });

    // Add notes
    if (notesData && notesData.length > 0) {
      notesData.forEach((note, index) => {
        doc.addPage();

        // Reset to black for chapter content
        doc.fillColor('#000000');

        // Chapter header
        doc.fontSize(20).font('Helvetica-Bold');
        doc.text(note.chapter_name, { align: 'left' });

        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica').fillColor('#888888');
        const updatedDate = note.updated_at ? new Date(note.updated_at).toLocaleDateString() : 'N/A';
        doc.text(`Last updated: ${updatedDate}`, { align: 'left' });

        doc.moveDown(1);
        doc.fillColor('#000000');

        // Chapter content with proper word wrapping
        if (note.content && note.content.trim()) {
          doc.fontSize(11).font('Helvetica');
          addWrappedText(doc, note.content, {
            width: doc.page.width - 100,
            fontSize: 11,
            lineGap: 5
          });
        } else {
          doc.fontSize(11).font('Helvetica').fillColor('#999999');
          doc.text('No notes recorded for this chapter.', { align: 'left', oblique: true });
        }

        // Add spacing
        doc.moveDown(1.5);
      });
    } else {
      doc.addPage();
      doc.fontSize(14).fillColor('#999999');
      doc.text('No notes found for this book.', { align: 'center' });
    }

    // Add page numbers to all pages
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      // Draw a line separator
      doc.strokeColor('#cccccc').lineWidth(0.5);
      doc.moveTo(50, doc.page.height - 40).lineTo(doc.page.width - 50, doc.page.height - 40).stroke();

      // Add page number
      doc.fontSize(9).fillColor('#999999').font('Helvetica');
      doc.text(
        `Page ${i + 1} of ${totalPages}`,
        50,
        doc.page.height - 30,
        { align: 'center', width: doc.page.width - 100 }
      );
    }

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF', details: error.message });
  }
});

module.exports = router;
