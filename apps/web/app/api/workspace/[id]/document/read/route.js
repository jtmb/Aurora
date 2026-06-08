// @aurora/api/workspace/[id]/document/read - Read and parse .docx/.xlsx files

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { validateWorkspace, resolveSafePath } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';

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

    const body = await request.json().catch(() => ({}));
    const { filePath } = body;

    if (!filePath || !filePath.trim()) {
      return NextResponse.json({ error: { message: 'filePath is required' } }, { status: 400 });
    }

    const safePath = resolveSafePath(wsDir, filePath.trim());
    if (!safePath) {
      return NextResponse.json({ error: { message: 'Invalid file path' } }, { status: 400 });
    }

    if (!fs.existsSync(safePath)) {
      return NextResponse.json({ error: { message: 'File not found' } }, { status: 404 });
    }

    const ext = path.extname(safePath).toLowerCase();

    if (ext === '.docx') {
      const buffer = fs.readFileSync(safePath);
      const result = await mammoth.convertToHtml({ buffer });
      const textResult = await mammoth.extractRawText({ buffer });

      return NextResponse.json({
        filePath: filePath.trim(),
        type: 'docx',
        html: result.value,
        text: textResult.value,
        warnings: result.messages || []
      });
    }

    if (ext === '.xlsx') {
      const buffer = fs.readFileSync(safePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        return { name, rows };
      });

      // Convert to fortune-sheet format
      // IMPORTANT: FortuneSheet's initSheetData() processes ONLY celldata
      // (sparse format), not data (dense format). If celldata is missing,
      // it creates an empty grid and overwrites any data we provide.
      // We must supply both formats: celldata for initialization, data for
      // direct access.
      const fortuneData = sheets.map(sheet => {
        const maxCols = Math.max(...sheet.rows.map(r => r.length), 0);

        const data = sheet.rows.map(row => {
          const cells = [];
          for (let c = 0; c < maxCols; c++) {
            const v = row[c] !== undefined && row[c] !== null && row[c] !== '' ? row[c] : null;
            // FortuneSheet uses `m` (monitor/display value) for formula bar & rendering,
            // and `v` for raw value. Both must be set.
            cells.push(v !== null ? { v, m: String(v) } : null);
          }
          return cells;
        });

        const celldata = [];
        sheet.rows.forEach((row, r) => {
          for (let c = 0; c < maxCols; c++) {
            const v = row[c] !== undefined && row[c] !== null && row[c] !== '' ? row[c] : null;
            if (v !== null) {
              celldata.push({ r, c, v: { v, m: String(v) } });
            }
          }
        });

        return { name: sheet.name, data, celldata };
      });

      return NextResponse.json({
        filePath: filePath.trim(),
        type: 'xlsx',
        sheets,
        fortuneData
      });
    }

    return NextResponse.json(
      { error: { message: `Unsupported file type: ${ext}. Only .docx and .xlsx are supported.` } },
      { status: 400 }
    );
  } catch (error) {
    console.error('[workspace/document/read] Error:', error.message);
    return NextResponse.json(
      { error: { message: `Failed to read document: ${error.message}` } },
      { status: 500 }
    );
  }
}
