// @aurora/api/workspace/[id]/delete - Delete a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import { validateWorkspace } from '../../../../../lib/workspace-utils';

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    // Remove the entire workspace directory
    fs.rmSync(wsDir, { recursive: true, force: true });
    
    return NextResponse.json({ success: true, message: 'Workspace deleted' });
  } catch (error) {
    console.error('[workspace/delete] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to delete workspace' } }, { status: 500 });
  }
}
