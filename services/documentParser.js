const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PARSER_TIMEOUT_MS = Number(process.env.WRITING_AGENT_PARSE_TIMEOUT_MS || 20000);

function clip(text, limit = 40000) {
  const raw = String(text || '').replace(/\u0000/g, '').trim();
  return raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
}

function buildPythonCandidates() {
  const home = os.homedir();
  return [
    process.env.WRITING_AGENT_PYTHON || '',
    'python',
    'python3',
    path.join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
    path.join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe')
  ].filter(Boolean);
}

function resolvePythonExecutables() {
  const seen = new Set();
  return buildPythonCandidates().filter(candidate => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return candidate === 'python' || candidate === 'python3' || fs.existsSync(candidate);
  });
}

const PYTHON_SCRIPT = `
import json
import sys
import os

kind = sys.argv[1]
path = sys.argv[2]

if not path or not os.path.exists(path):
    raise SystemExit("File not found")

def read_pdf(file_path):
    try:
        from pypdf import PdfReader
    except Exception:
        from PyPDF2 import PdfReader
    reader = PdfReader(file_path)
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return "\\n\\n".join(pages)

def read_docx(file_path):
    from docx import Document
    doc = Document(file_path)
    parts = []
    for paragraph in doc.paragraphs:
        if paragraph.text:
            parts.append(paragraph.text)
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                parts.append(row_text)
    return "\\n".join(parts)

if kind == "pdf":
    text = read_pdf(path)
elif kind == "docx":
    text = read_docx(path)
else:
    raise SystemExit("Unsupported kind")

print(json.dumps({"text": text}))
`;

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function detectKind(filename = '', mimeType = '') {
  const lowerName = filename.toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    lowerMime.includes('wordprocessingml') ||
    lowerMime.includes('msword') ||
    lowerName.endsWith('.docx')
  ) return 'docx';
  if (lowerMime.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'text';
  return null;
}

async function parseUploadedDocument({ name, mimeType, base64 }) {
  const kind = detectKind(name, mimeType);
  if (!kind) {
    throw new Error(`Unsupported file type for ${name}`);
  }

  const buffer = Buffer.from(base64, 'base64');
  if (kind === 'text') {
    return {
      title: name,
      mime_type: mimeType || 'text/plain',
      content: clip(buffer.toString('utf8'))
    };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'writeflow-essay-'));
  const tempPath = path.join(tempRoot, name);
  fs.writeFileSync(tempPath, buffer);

  try {
    let stdout = '';
    let lastError = null;
    for (const python of resolvePythonExecutables()) {
      try {
        const result = await execFileAsync(
          python,
          ['-c', PYTHON_SCRIPT, kind, tempPath],
          {
            timeout: PARSER_TIMEOUT_MS,
            maxBuffer: 1024 * 1024 * 8
          }
        );
        stdout = result.stdout;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    const parsed = JSON.parse(stdout || '{}');
    return {
      title: name,
      mime_type: mimeType || '',
      content: clip(parsed.text || '')
    };
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    try { fs.rmdirSync(tempRoot); } catch (_) {}
  }
}

module.exports = {
  parseUploadedDocument
};
