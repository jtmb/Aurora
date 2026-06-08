// @aurora/api/workspace/[id]/skills/[name] - Individual skill operations

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../../lib/workspace-utils';
import { getUserId } from '../../../../../../lib/auth-utils';
import { loadAllSkills, deleteSkill } from '../../../../../../lib/skills-utils';

export async function GET(request, { params }) {
  try {
    const { id, name } = await params;
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }
    const wsDir = validateWorkspace(id, userId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const skills = loadAllSkills(wsDir);
    const skill = skills.find(s =>
      s.name === decodeURIComponent(name) ||
      s.path.endsWith(decodeURIComponent(name))
    );

    if (!skill) {
      return NextResponse.json({ error: { message: 'Skill not found' } }, { status: 404 });
    }

    return NextResponse.json({ skill });
  } catch (error) {
    console.error('[skills/name] GET error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to load skill' } }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id, name } = await params;
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }
    const wsDir = validateWorkspace(id, userId);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    const result = deleteSkill(wsDir, decodeURIComponent(name));
    if (!result.success) {
      return NextResponse.json({ error: { message: result.error } }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[skills/name] DELETE error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to delete skill' } }, { status: 500 });
  }
}
