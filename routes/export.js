const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const supabase = require('../services/supabase');

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
    doc.fontSize(28).font('Helvetica-Bold').text(bookData.title, { align: 'center', margin: 40 });
    doc.fontSize(14).font('Helvetica').text(bookData.author || 'Unknown Author', { align: 'center', margin: 20 });

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(11).text(`Generated on ${today}`, { align: 'center', margin: 20 });

    doc.moveDown(2);
    doc.fontSize(12).font('Helvetica').text('Chapter Notes', { align: 'center', underline: true });

    // Add notes
    if (notesData && notesData.length > 0) {
      notesData.forEach((note, index) => {
        doc.addPage();

        // Chapter header
        doc.fontSize(18).font('Helvetica-Bold').text(note.chapter_name, { margin: 30 });
        doc.fontSize(10).font('Helvetica').fillColor('#666666').text(`Updated: ${new Date(note.updated_at).toLocaleDateString()}`, { margin: 5 });

        doc.fontSize(10).fillColor('#000000');
        doc.font('Helvetica');

        // Chapter content
        if (note.content) {
          const lines = doc.heightOfString(note.content, {
            width: doc.page.width - 100,
            align: 'left'
          });

          doc.moveDown(0.5);
          doc.text(note.content, {
            width: doc.page.width - 100,
            align: 'left',
            lineGap: 4
          });
        } else {
          doc.moveDown(0.5);
          doc.text('No notes recorded for this chapter.', {
            align: 'left',
            oblique: true,
            color: '#999999'
          });
        }

        // Add spacing between chapters
        doc.moveDown(1);
      });
    } else {
      doc.addPage();
      doc.fontSize(12).text('No notes found for this book.', { align: 'center', margin: 100 });
    }

    // Footer with page numbers
    const pages = doc.bufferedPageRange().count;
    for (let i = 1; i <= pages; i++) {
      doc.switchToPage(i - 1);
      doc.fontSize(9).fillColor('#aaaaaa').text(
        `Page ${i} of ${pages}`,
        50,
        doc.page.height - 30,
        { align: 'center' }
      );
    }

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

module.exports = router;
