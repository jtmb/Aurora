// @aurora/web - Checkpoint git helpers (separate git repo at .aurora/checkpoints/)

import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';

/**
 * Get the path to the checkpoint git directory for a workspace.
 * Stored at .aurora/checkpoints/ within the workspace.
 */
export function getCheckpointDir(wsDir) {
  return path.join(wsDir, '.aurora', 'checkpoints');
}

/**
 * Initialize the checkpoint git repository for a workspace.
 * Uses GIT_DIR/GIT_WORK_TREE so the repo lives at .aurora/checkpoints/
 * but tracks files in the workspace root.
 *
 * @param {string} wsDir - Absolute path to the workspace directory
 * @returns {{ success: boolean, initialHash?: string, error?: string }}
 */
export async function initWorkspaceCheckpoints(wsDir) {
  try {
    const ckDir = getCheckpointDir(wsDir);

    // Ensure .aurora/ directory exists
    const auroraDir = path.join(wsDir, '.aurora');
    if (!fs.existsSync(auroraDir)) {
      fs.mkdirSync(auroraDir, { recursive: true });
    }

    // Ensure .aurora/ is in .gitignore so workspace git ignores it
    const gitignorePath = path.join(wsDir, '.gitignore');
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : '';
    const lines = existing.split('\n').map(l => l.trim());
    if (!lines.includes('.aurora/') && !lines.includes('.aurora')) {
      const newContent = existing
        ? (existing.endsWith('\n') ? existing : existing + '\n') + '.aurora/\n'
        : '.aurora/\n';
      fs.writeFileSync(gitignorePath, newContent);
    }

    // Create checkpoint directory if needed
    if (!fs.existsSync(ckDir)) {
      fs.mkdirSync(ckDir, { recursive: true });
    }

    const git = simpleGit(wsDir).env({
      GIT_DIR: ckDir,
      GIT_WORK_TREE: wsDir,
    });

    // Check if already initialized
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (isRepo) {
      console.log('[checkpoint] Git already initialized at', ckDir);
      // Get initial commit hash if tagged
      try {
        const tags = await git.tags();
        if (tags.all.includes('initial')) {
          return { success: true, initialHash: 'initial' };
        }
      } catch {}
      return { success: true };
    }

    // Init the git repo
    await git.init(['-b', 'main']);

    // Set local identity for this repo (required for commits)
    await git.addConfig('user.name', 'Aurora Agent');
    await git.addConfig('user.email', 'aurora@agent.local');

    // Stage everything (respects .gitignore which already excludes .aurora/)
    await git.add('.').catch(() => {});

    // Create initial commit and tag it
    const status = await git.status();
    if (status.files.length > 0 || status.created.length > 0) {
      const commitResult = await git.commit('checkpoint: initial workspace state');
      await git.addTag('initial');
      const hash = commitResult.commit?.slice(0, 7) || 'unknown';
      console.log(`[checkpoint] Initialized checkpoint git at ${ckDir}, commit ${hash}`);
      return { success: true, initialHash: hash };
    }

    // Empty repo — still tag for consistency
    console.log(`[checkpoint] Initialized empty checkpoint git at ${ckDir}`);
    return { success: true };
  } catch (error) {
    console.error('[checkpoint/init] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Create a checkpoint commit tagged with the given tag.
 * Stages ALL changes (add -A) and commits with tag cp_{tag}.
 *
 * @param {string} wsDir - Absolute path to the workspace directory
 * @param {string} tag - Unique tag for this checkpoint (typically a message ID)
 * @returns {{ success: boolean, hash?: string, error?: string }}
 */
export async function createWorkspaceCheckpoint(wsDir, tag) {
  try {
    const ckDir = getCheckpointDir(wsDir);

    if (!fs.existsSync(ckDir)) {
      return { success: false, error: 'Checkpoint git not initialized' };
    }

    const git = simpleGit(wsDir).env({
      GIT_DIR: ckDir,
      GIT_WORK_TREE: wsDir,
    });

    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return { success: false, error: 'Not a checkpoint git repository' };
    }

    // Stage all changes including deletions (use '.' which respects .gitignore)
    await git.add('.').catch(() => {});

    // Check if there's anything to commit
    const status = await git.status();
    const hasChanges = status.staged.length > 0
      || status.created.length > 0
      || status.deleted.length > 0
      || status.modified.length > 0;

    if (!hasChanges) {
      // Still force-tag current HEAD so restore can always find this checkpoint
      const safeTag = tag.replace(/[^a-zA-Z0-9_-]/g, '_');
      try {
        await git.tag(['-f', `cp_${safeTag}`]).catch(() => {});
      } catch {}
      return { success: true, hash: null, note: 'No changes to commit — tagged current HEAD' };
    }

    // Commit
    const safeTag = tag.replace(/[^a-zA-Z0-9_-]/g, '_');
    const commitResult = await git.commit(`checkpoint: ${safeTag}`);
    const hash = commitResult.commit?.slice(0, 7) || 'unknown';

    // Tag the commit
    try {
      await git.addTag(`cp_${safeTag}`);
    } catch (tagErr) {
      // Tag might already exist (e.g., retry on same message) — force update
      await git.tag(['-f', `cp_${safeTag}`]).catch(() => {});
    }

    console.log(`[checkpoint] Created checkpoint cp_${safeTag} at ${hash}`);
    return { success: true, hash };
  } catch (error) {
    console.error('[checkpoint/create] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * List all checkpoints for a workspace with metadata.
 * Returns tags, commit hashes, dates, and messages sorted by date desc.
 *
 * @param {string} wsDir - Absolute path to the workspace directory
 * @returns {{ success: boolean, checkpoints?: Array, error?: string }}
 */
export async function listWorkspaceCheckpoints(wsDir) {
  try {
    const ckDir = getCheckpointDir(wsDir);

    if (!fs.existsSync(ckDir)) {
      return { success: true, checkpoints: [] };
    }

    const git = simpleGit(wsDir).env({
      GIT_DIR: ckDir,
      GIT_WORK_TREE: wsDir,
    });

    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return { success: true, checkpoints: [] };
    }

    // Get all tags
    const tagsResult = await git.tags();
    const allTags = tagsResult.all || [];

    // Collect checkpoint tags (cp_*) plus "initial"
    const checkpointTags = allTags.filter(
      t => t.startsWith('cp_') || t === 'initial'
    );

    if (checkpointTags.length === 0) {
      return { success: true, checkpoints: [] };
    }

    // For each tag, get commit info using git log -1 --format
    const checkpoints = [];
    for (const tag of checkpointTags) {
      try {
        const logOutput = await git.raw([
          'log', '-1', '--format=%H%n%ai%n%s', tag
        ]);
        const [hash, date, ...msgParts] = logOutput.trim().split('\n');
        const message = msgParts.join(' ').trim();
        checkpoints.push({
          tag,
          hash: hash?.slice(0, 7) || 'unknown',
          fullHash: hash || 'unknown',
          date: date || null,
          message: message || ''
        });
      } catch {
        // Tag exists but no commit (unlikely), skip
        checkpoints.push({
          tag,
          hash: 'unknown',
          fullHash: 'unknown',
          date: null,
          message: ''
        });
      }
    }

    // Sort by date descending (most recent first), initial always last or by date
    checkpoints.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    console.log(`[checkpoint] Listed ${checkpoints.length} checkpoints for workspace`);
    return { success: true, checkpoints };
  } catch (error) {
    console.error('[checkpoint/list] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Restore the workspace working tree to a checkpoint tag.
 * Uses git reset --hard to restore the entire working tree atomically.
 * This is O(1) — a single fast operation regardless of file count.
 *
 * @param {string} wsDir - Absolute path to the workspace directory
 * @param {string} tag - The checkpoint tag to restore to (without cp_ prefix, use "initial" for initial state)
 * @returns {{ success: boolean, error?: string }}
 */
export async function restoreWorkspaceCheckpoint(wsDir, tag) {
  try {
    const ckDir = getCheckpointDir(wsDir);

    if (!fs.existsSync(ckDir)) {
      return { success: false, error: 'Checkpoint git not initialized' };
    }

    const git = simpleGit(wsDir).env({
      GIT_DIR: ckDir,
      GIT_WORK_TREE: wsDir,
    });

    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return { success: false, error: 'Not a checkpoint git repository' };
    }

    const ref = tag === 'initial' ? 'initial' : `cp_${tag.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    // Verify the ref exists
    const refExists = await git.raw(['rev-parse', '--verify', ref]).then(() => true).catch(() => false);
    if (!refExists) {
      return { success: false, error: `Checkpoint "${tag}" not found` };
    }

    // git reset --hard restores HEAD, index, and working tree to ref state
    // This handles file additions, deletions, and modifications atomically
    await git.raw(['reset', '--hard', ref]);

    // Remove untracked files and directories (created after the checkpoint)
    await git.clean('f', ['-d']);

    console.log(`[checkpoint] Restored workspace to checkpoint "${tag}" (ref: ${ref})`);
    return { success: true };
  } catch (error) {
    console.error('[checkpoint/restore] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Completely reset the workspace to a blank state.
 * Deletes all user files (keeping .aurora/ and .gitignore),
 * then re-initializes the checkpoint git so the "initial" tag
 * points at the clean empty state.
 *
 * @param {string} wsDir - Absolute path to the workspace directory
 * @returns {{ success: boolean, error?: string }}
 */
export async function resetWorkspaceToClean(wsDir) {
  try {
    // 1. Delete ALL workspace files except .aurora/ and .gitignore
    if (fs.existsSync(wsDir)) {
      const entries = fs.readdirSync(wsDir);
      for (const entry of entries) {
        if (entry === '.aurora' || entry === '.gitignore' || entry === '.git') continue;
        const entryPath = path.join(wsDir, entry);
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    }

    // 2. Remove old checkpoint git entirely so re-init starts fresh
    const ckDir = getCheckpointDir(wsDir);
    if (fs.existsSync(ckDir)) {
      fs.rmSync(ckDir, { recursive: true, force: true });
    }

    // 3. Re-init checkpoint git with clean slate "initial" tag
    const result = await initWorkspaceCheckpoints(wsDir);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`[checkpoint] Reset workspace to clean state: ${wsDir}`);
    return { success: true };
  } catch (error) {
    console.error('[checkpoint/reset] Error:', error.message);
    return { success: false, error: error.message };
  }
}
