// @aurora/api/workspace/[id]/skills - Agent-learned reusable pattern skills

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import { loadAllSkills, loadAllGlobalSkills, createSkill, createGlobalSkill } from '../../../../../lib/skills-utils';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }

    // Load per-workspace skills
    const wsSkills = loadAllSkills(wsDir);
    // Load global skills (survive workspace deletions)
    const globalSkills = loadAllGlobalSkills();

    // Merge: global first, then workspace — deduplicate by name
    const seenNames = new Set();
    const allSkills = [];
    for (const s of [...globalSkills, ...wsSkills]) {
      if (!seenNames.has(s.name)) {
        seenNames.add(s.name);
        allSkills.push(s);
      }
    }

    // Return trimmed content for listing (full content via individual GET)
    const skillList = allSkills.map(s => ({
      name: s.name,
      description: s.description,
      applyTo: s.applyTo,
      scope: s.scope || 'workspace',
      contentPreview: s.contentPreview || s.content?.slice(0, 200) || ''
    }));

    return NextResponse.json({ skills: skillList });
  } catch (error) {
    console.error('[skills] GET error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to load skills' } }, { status: 500 });
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
    const { name, description, applyTo, content, scope } = body;

    if (!name || !content) {
      return NextResponse.json({ error: { message: 'name and content are required' } }, { status: 400 });
    }

    // Support 'global' scope for build/pattern skills that should survive workspace deletion
    const effectiveScope = scope || 'workspace';
    const result = effectiveScope === 'global'
      ? createGlobalSkill(name, description || '', applyTo || '', content)
      : createSkill(wsDir, name, description || '', applyTo || '', content);

    if (!result.success) {
      return NextResponse.json({ error: { message: result.error } }, { status: 500 });
    }

    return NextResponse.json({ success: true, path: result.path, scope: effectiveScope }, { status: 201 });
  } catch (error) {
    console.error('[skills] POST error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to create skill' } }, { status: 500 });
  }
}
