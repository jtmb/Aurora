// @aurora/api/workspace/[id]/document/write - Write changes to .docx/.xlsx files

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from 'docx';
import { validateWorkspace, resolveSafePath } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';

/**
 * Simple HTML to docx converter.
 * Parses HTML content string and builds a docx Document.
 * Supports: h1-h6, p, strong, em, ul, ol, li, table/tr/td.
 */
function htmlToDocxElements(html) {
  const elements = [];

  // Simple regex-based parser (handles common Word HTML output)
  const tagRegex = /<(\/?)(\w+)([^>]*)>/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: html.slice(lastIndex, match.index) });
    }
    parts.push({
      type: match[1] ? 'close' : 'open',
      tag: match[2].toLowerCase(),
      attrs: match[3]
    });
    lastIndex = tagRegex.lastIndex;
  }
  if (lastIndex < html.length) {
    parts.push({ type: 'text', content: html.slice(lastIndex) });
  }

  // Convert parts to a flat structure for context tracking
  const flat = parts.map(p => p);

  // Simple state-machine approach: group by block-level tags
  let i = 0;
  while (i < flat.length) {
    const part = flat[i];

    if (part.type === 'open') {
      const tag = part.tag;

      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        // Collect text until closing tag
        const levelMap = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6 };
        let textContent = '';
        i++;
        while (i < flat.length && !(flat[i].type === 'close' && flat[i].tag === tag)) {
          if (flat[i].type === 'text') textContent += flat[i].content;
          i++;
        }
        elements.push(new Paragraph({
          text: textContent.trim(),
          heading: levelMap[tag]
        }));
        i++;
        continue;
      }

      if (tag === 'p') {
        // Collect inline content
        const runs = [];
        let textContent = '';
        i++;
        const tempParts = [];
        while (i < flat.length && !(flat[i].type === 'close' && flat[i].tag === 'p')) {
          tempParts.push(flat[i]);
          i++;
        }
        // Process temp parts for bold/italic
        let j = 0;
        while (j < tempParts.length) {
          const tp = tempParts[j];
          if (tp.type === 'open' && tp.tag === 'strong') {
            let boldText = '';
            j++;
            while (j < tempParts.length && !(tempParts[j].type === 'close' && tempParts[j].tag === 'strong')) {
              if (tempParts[j].type === 'text') boldText += tempParts[j].content;
              j++;
            }
            if (boldText.trim()) {
              runs.push(new TextRun({ text: boldText.trim(), bold: true }));
            }
            j++;
          } else if (tp.type === 'open' && tp.tag === 'em') {
            let italicText = '';
            j++;
            while (j < tempParts.length && !(tempParts[j].type === 'close' && tempParts[j].tag === 'em')) {
              if (tempParts[j].type === 'text') italicText += tempParts[j].content;
              j++;
            }
            if (italicText.trim()) {
              runs.push(new TextRun({ text: italicText.trim(), italics: true }));
            }
            j++;
          } else if (tp.type === 'text') {
            if (tp.content.trim()) {
              runs.push(new TextRun({ text: tp.content.trim() }));
            }
            j++;
          } else {
            j++;
          }
        }
        if (runs.length > 0) {
          elements.push(new Paragraph({ children: runs }));
        } else {
          elements.push(new Paragraph({ text: '' }));
        }
        i++;
        continue;
      }

      if (tag === 'table') {
        const rows = [];
        i++;
        while (i < flat.length && !(flat[i].type === 'close' && flat[i].tag === 'table')) {
          if (flat[i].type === 'open' && flat[i].tag === 'tr') {
            const cells = [];
            i++;
            while (i < flat.length && !(flat[i].type === 'close' && flat[i].tag === 'tr')) {
              if (flat[i].type === 'open' && (flat[i].tag === 'td' || flat[i].tag === 'th')) {
                const cellTag = flat[i].tag;
                let cellText = '';
                i++;
                while (i < flat.length && !(flat[i].type === 'close' && flat[i].tag === cellTag)) {
                  if (flat[i].type === 'text') cellText += flat[i].content;
                  i++;
                }
                cells.push(new TableCell({
                  children: [new Paragraph({ text: cellText.trim() })]
                }));
              }
              i++;
            }
            rows.push(new TableRow({ children: cells }));
          }
          i++;
        }
        if (rows.length > 0) {
          elements.push(new Table({
            rows,
            width: { size: 100, type: WidthType.PERCENTAGE }
          }));
        }
        i++;
        continue;
      }
    }

    if (part.type === 'text' && part.content.trim()) {
      elements.push(new Paragraph({ text: part.content.trim() }));
    }
    i++;
  }

  return elements;
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }

    const wsDir = validateWorkspace(id, userId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const contentType = request.headers.get('content-type') || '';

    // ── Multipart/form-data: binary xlsx write (from fortune-excel) ──
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      const filePathOverride = formData.get('filePath');

      if (!file) {
        return NextResponse.json({ error: { message: 'No file provided' } }, { status: 400 });
      }

      const targetPath = filePathOverride?.trim() || file.name;
      const safePath = resolveSafePath(wsDir, targetPath);
      if (!safePath) {
        return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 400 });
      }

      const ext = path.extname(safePath).toLowerCase();
      if (ext !== '.xlsx') {
        return NextResponse.json({ error: { message: 'Only .xlsx files supported for binary write' } }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(safePath, buffer);

      const ckResult = await createWorkspaceCheckpoint(wsDir, 'doc_' + Date.now());
      if (!ckResult.success) {
        console.warn('[document/write] Checkpoint creation warning:', ckResult.error);
      }

      return NextResponse.json({
        success: true,
        filePath: targetPath,
        checkpointHash: ckResult.hash || null
      });
    }

    // ── JSON body: docx HTML or legacy xlsx sheets ──
    const body = await request.json().catch(() => ({}));
    const { filePath, content } = body;

    if (!filePath || !filePath.trim()) {
      return NextResponse.json({ error: { message: 'filePath is required' } }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ error: { message: 'content is required' } }, { status: 400 });
    }

    const safePath = resolveSafePath(wsDir, filePath.trim());
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 400 });
    }

    const ext = path.extname(safePath).toLowerCase();

    if (ext === '.docx') {
      let htmlContent = null;

      // Structured format: { type: "docx", html: "..." }
      if (content && typeof content === 'object' && content.type === 'docx' && content.html) {
        htmlContent = content.html;
      }
      // Plain text content — wrap in HTML paragraphs
      else if (typeof content === 'string') {
        const paragraphs = content.split(/\n{2,}/).filter(Boolean);
        htmlContent = paragraphs.map(p =>
          `<p>${p.replace(/\n/g, '<br/>')}</p>`
        ).join('\n');
      }
      // Plain text in object form (agent may send { content: "text" } or just the raw text)
      else if (content && typeof content === 'object' && typeof content.content === 'string') {
        const text = content.content;
        const paragraphs = text.split(/\n{2,}/).filter(Boolean);
        htmlContent = paragraphs.map(p =>
          `<p>${p.replace(/\n/g, '<br/>')}</p>`
        ).join('\n');
      }
      // Fallback: stringify whatever we got
      else if (content) {
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        htmlContent = `<p>${text.replace(/\n/g, '<br/>')}</p>`;
      }

      if (!htmlContent) {
        return NextResponse.json(
          { error: { message: 'For .docx files, content must be { type: "docx", html: "..." } or a plain text string' } },
          { status: 400 }
        );
      }

      // Convert HTML to docx elements and build the document
      const elements = htmlToDocxElements(htmlContent);
      const doc = new Document({
        sections: [{
          properties: {},
          children: elements.length > 0 ? elements : [new Paragraph({ text: '' })]
        }]
      });

      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(safePath, buffer);
    } else if (ext === '.xlsx') {
      // Accept plain 2D array as well as structured sheets format
      let sheets = null;
      if (content && typeof content === 'object' && content.type === 'xlsx' && content.sheets) {
        sheets = content.sheets;
      } else if (Array.isArray(content)) {
        sheets = [{ name: 'Sheet1', rows: content }];
      } else if (content && typeof content === 'object' && Array.isArray(content.sheets)) {
        sheets = content.sheets;
      } else if (typeof content === 'string') {
        // Parse CSV-like string
        const rows = content.split('\n').filter(Boolean).map(line =>
          line.split(',').map(cell => cell.trim())
        );
        sheets = [{ name: 'Sheet1', rows }];
      }

      if (!sheets) {
        return NextResponse.json(
          { error: { message: 'For .xlsx files, content must be { type: "xlsx", sheets: [...] }, a 2D array, or a CSV string' } },
          { status: 400 }
        );
      }

      // Build workbook from sheet data
      const workbook = XLSX.utils.book_new();
      for (const sheet of content.sheets) {
        const ws = XLSX.utils.aoa_to_sheet(sheet.rows || []);
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name || 'Sheet1');
      }

      // Use fs.writeFileSync instead of XLSX.writeFile (ESM compat)
      const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      fs.writeFileSync(safePath, xlsxBuffer);
    } else {
      return NextResponse.json(
        { error: { message: `Unsupported file type: ${ext}. Only .docx and .xlsx are supported.` } },
        { status: 400 }
      );
    }

    // Auto-create checkpoint after every write
    const ckResult = await createWorkspaceCheckpoint(wsDir, 'doc_' + Date.now());
    if (!ckResult.success) {
      console.warn('[document/write] Checkpoint creation warning:', ckResult.error);
    }

    return NextResponse.json({
      success: true,
      filePath: filePath.trim(),
      checkpointHash: ckResult.hash || null
    });
  } catch (error) {
    console.error('[workspace/document/write] Error:', error.message);
    return NextResponse.json(
      { error: { message: `Failed to write document: ${error.message}` } },
      { status: 500 }
    );
  }
}
