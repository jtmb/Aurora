// @aurora/api/workspace/create - Create or clone a workspace

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { simpleGit } from 'simple-git';
import { getWorkspaceDir, ensureWorkspacesDir } from '../../../../lib/workspace-utils';
import { initWorkspaceCheckpoints } from '../../../../lib/checkpoint-utils';
import { getUserId } from '../../../../lib/auth-utils';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { name, repoUrl, type = 'blank', codeMode = 'full', workspaceType = 'code' } = body;

    // Require authentication
    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }
    
    if (!name || !name.trim()) {
      return NextResponse.json({ error: { message: 'Workspace name is required' } }, { status: 400 });
    }

    // Validate workspaceType
    if (!['code', 'documents'].includes(workspaceType)) {
      return NextResponse.json({ error: { message: 'workspaceType must be "code" or "documents"' } }, { status: 400 });
    }

    // Documents workspaces don't support git clone
    if (workspaceType === 'documents' && repoUrl) {
      return NextResponse.json({ error: { message: 'Documents workspaces do not support git clone' } }, { status: 400 });
    }
    
    ensureWorkspacesDir();

    // Generate a unique ID — directory names use UUID so two users can have
    // workspaces with the same display name without collision.
    const workspaceId = crypto.randomUUID();
    const wsDir = getWorkspaceDir(workspaceId);
    
    const createdAt = new Date().toISOString();
    let cloneSuccess = false;
    
    if (repoUrl && type === 'git') {
      // Clone the repository
      try {
        const git = simpleGit();
        await git.clone(repoUrl, wsDir, ['--depth', '1']);
        cloneSuccess = true;
      } catch (gitErr) {
        console.error('[workspace/create] Git clone error:', gitErr.message);
        // Clean up partial clone
        if (fs.existsSync(wsDir)) {
          fs.rmSync(wsDir, { recursive: true, force: true });
        }
        return NextResponse.json({ error: { message: `Failed to clone repository: ${gitErr.message}` } }, { status: 500 });
      }
    } else {
      // Create blank workspace directory
      fs.mkdirSync(wsDir, { recursive: true });
    }

    // Bootstrap AGENTS.md with full Next.js rules so the coding agent knows the runtime environment
    // and project conventions. Framework rules are included directly (no deferred injection).
    // Only write if no AGENTS.md or CLAUDE.md already exists (cloned repos may have one).
    const existingAgents = fs.existsSync(path.join(wsDir, 'AGENTS.md'));
    const existingClaude = fs.existsSync(path.join(wsDir, 'CLAUDE.md'));
    if (!existingAgents && !existingClaude) {
      const agentsMd = `# Workspace: ${name.trim()}

## Runtime Environment

| Tool | Version |
|------|---------|
| Node.js | v22.22.3 |
| npm | 10.9.8 |
| Python | 3.12.3 |

## Universal Rules

1. **Discover first**: Use \`list_dir\` and \`read_file\` to understand the project before writing code.
2. **Respect existing tooling**: Use whatever package manager and build system the project already has.
3. **Don't downgrade**: NEVER replace a framework project with a static HTML file because the dev server fails. Debug it instead.

## Next.js Project

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in \`node_modules/next/dist/docs/\` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

- **Version**: Use \`"next": "latest"\` in package.json (NOT "15.0.0"). Next 16+ works with React 19.
- **React**: \`"react": "^19.0.0"\`, \`"react-dom": "^19.0.0"\`.
- **App Router**: Use \`app/\` directory with \`page.tsx\`/\`layout.tsx\`, not \`pages/\`.
- **🚫 NO src/ DIRECTORY**: Place ALL files at the project root (e.g., \`app/page.tsx\`, \`app/layout.tsx\`). Do NOT nest inside \`src/\` — this is OLD Next.js convention and WILL cause CSS/build failures.
- **Dev command**: \`npm run dev\`
- **Port**: Default 3000, auto-assigned to avoid conflicts.
- **Deps**: \`npm install --legacy-peer-deps\` runs automatically if node_modules is missing.
- **TypeScript**: Next.js auto-installs TypeScript deps when it detects \`tsconfig.json\`.
- **Tailwind**: Use v3 (\`tailwindcss@^3\`), not v4. Requires \`postcss.config.js\` with \`tailwindcss\` and \`autoprefixer\` plugins. Tailwind v4 has completely different syntax — \`@tailwind\` directives and \`tailwind.config.ts\` files only work with v3.
`;
      fs.writeFileSync(path.join(wsDir, 'AGENTS.md'), agentsMd);
    }

    // Bootstrap .aurora/ directory for self-improving agent infrastructure
    const auroraDir = path.join(wsDir, '.aurora');
    if (!fs.existsSync(auroraDir)) {
      fs.mkdirSync(auroraDir, { recursive: true });
      // Create empty corpus.jsonl
      fs.writeFileSync(path.join(auroraDir, 'corpus.jsonl'), '');
      // Create skills/ directory
      const skillsDir = path.join(auroraDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });
      // Create skills README explaining auto-creation
      const skillsReadme = `# Agent-Learned Skills

This directory contains reusable coding patterns automatically extracted by the Aurora AI agent
after successful build sessions. Skills are **not** manually managed — the agent creates, updates,
and deletes them as it learns.

## How Skills Work

1. During a build session, the agent detects friction events (build failures, stuck loops, etc.)
2. These events are recorded in \`.aurora/corpus.jsonl\` to prevent future repetition
3. After a **successful** build (2+ files created, all tasks complete), the agent auto-extracts
   reusable patterns into this directory
4. On subsequent requests, matching skills are injected into the agent's system prompt

## Skill File Format

Skills are Markdown files with YAML frontmatter:

\`\`\`markdown
---
name: Pattern Name
description: What this skill covers
applyTo: keyword1, keyword2, keyword3
created: 2025-01-15T00:00:00.000Z
---

Markdown instructions for reproducing this pattern...
\`\`\`

## Keyword Matching

The \`applyTo\` field controls which user requests trigger this skill.
Keywords are matched as **case-insensitive substrings** against the user's message.
A skill with no \`applyTo\` keywords is considered general-purpose and always injected.

## Do Not Edit Manually

Skills are maintained entirely by the agent. Manual edits may be overwritten.
If you need to remove a skill, delete its \`.md\` file.
`;
      fs.writeFileSync(path.join(skillsDir, 'README.md'), skillsReadme);
    }
    
    // Ensure .aurora/ is in .gitignore so internal metadata never shows as git changes
    const gitignorePath = path.join(wsDir, '.gitignore');
    const existingGitignore = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : '';
    const gitignoreLines = existingGitignore.split('\n').map(l => l.trim());
    if (!gitignoreLines.includes('.aurora/') && !gitignoreLines.includes('.aurora')) {
      const newContent = existingGitignore
        ? (existingGitignore.endsWith('\n') ? existingGitignore : existingGitignore + '\n') + '.aurora/\n'
        : '.aurora/\n';
      fs.writeFileSync(gitignorePath, newContent);
    }

    // Write metadata
    const metadata = {
      name: name.trim(),
      repoUrl: repoUrl || null,
      type: type || 'blank',
      codeMode: codeMode || 'full',
      workspaceType: workspaceType || 'code',
      ownerId: userId,
      createdAt,
      lastOpened: createdAt
    };
    
    fs.writeFileSync(path.join(wsDir, '.aurora', 'workspace.json'), JSON.stringify(metadata, null, 2));

    // Initialize checkpoint git for filesystem snapshots (separate from workspace git)
    const ckResult = await initWorkspaceCheckpoints(wsDir);
    if (!ckResult.success) {
      console.warn(`[workspace/create] Checkpoint init warning: ${ckResult.error}`);
    }
    
    return NextResponse.json({
      id: workspaceId,
      ...metadata,
      isGitRepo: cloneSuccess || (repoUrl ? true : false)
    }, { status: 201 });
    
  } catch (error) {
    console.error('[workspace/create] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to create workspace' } }, { status: 500 });
  }
}
