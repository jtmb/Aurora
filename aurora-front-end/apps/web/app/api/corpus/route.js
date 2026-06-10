// @aurora/api/corpus - Global cross-workspace problem/solution corpus

import { NextResponse } from 'next/server';
import { appendCorpusEntry, getGlobalCorpusPath } from '../../../lib/corpus-utils';
import fs from 'fs';

export async function GET() {
  try {
    const globalPath = getGlobalCorpusPath();
    const entries = [];

    if (fs.existsSync(globalPath)) {
      const raw = fs.readFileSync(globalPath, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0 && entries.length < 50; i--) {
        try {
          entries.push(JSON.parse(lines[i]));
        } catch {}
      }
    }

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[global-corpus] GET error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to load global corpus' } }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { type, problem, context, resolution, workspaceId } = body;

    if (!type || !problem) {
      return NextResponse.json({ error: { message: 'type and problem are required' } }, { status: 400 });
    }

    const entry = appendCorpusEntry(type, problem, context || '', resolution || '', workspaceId || '');
    if (!entry) {
      return NextResponse.json({ success: true, deduped: true, message: 'Duplicate entry skipped' });
    }

    return NextResponse.json({ success: true, entryId: entry.hash });
  } catch (error) {
    console.error('[global-corpus] POST error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to append corpus entry' } }, { status: 500 });
  }
}
