// @aurora/api/workspace/[id]/corpus - Per-workspace problem/solution corpus

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { appendCorpusEntry, loadRecentCorpus, markResolved } from '../../../../../lib/corpus-utils';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const entries = loadRecentCorpus(wsDir, 50);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[corpus] GET error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to load corpus' } }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { type, problem, context, resolution } = body;

    if (!type || !problem) {
      return NextResponse.json({ error: { message: 'type and problem are required' } }, { status: 400 });
    }

    const entry = appendCorpusEntry(type, problem, context || '', resolution || '', wsDir);
    if (!entry) {
      return NextResponse.json({ success: true, deduped: true, message: 'Duplicate entry skipped' });
    }

    return NextResponse.json({ success: true, entryId: entry.hash });
  } catch (error) {
    console.error('[corpus] POST error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to append corpus entry' } }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { entryId, resolution } = body;

    if (!entryId) {
      return NextResponse.json({ error: { message: 'entryId is required' } }, { status: 400 });
    }

    const updated = markResolved(wsDir, entryId, resolution || '');
    return NextResponse.json({ success: updated });
  } catch (error) {
    console.error('[corpus] PATCH error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to update corpus entry' } }, { status: 500 });
  }
}
