// @aurora/web - Corpus utilities for self-improving agent problem/solution tracking
//
// Dual-scope corpus:
// - Per-workspace: {wsDir}/.aurora/corpus.jsonl (context-specific learnings)
// - Global: /home/brajam/repos/Aurora/.aurora/corpus.jsonl (cross-project knowledge)
//
// Deduplication: SHA256 hash of type + problem[0:200] checked against last 50 entries.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const LAST_N_DEDUP = 50;
const MAX_GLOBAL_ENTRIES = 500;

/**
 * Returns the path to the global corpus file (shared across all workspaces).
 */
export function getGlobalCorpusPath() {
  return path.join(process.cwd(), '.aurora', 'corpus.jsonl');
}

/**
 * Returns the path to a workspace-scoped corpus file.
 */
export function getWorkspaceCorpusPath(wsDir) {
  return path.join(wsDir, '.aurora', 'corpus.jsonl');
}

/**
 * Generate a deduplication hash from type + problem snippet.
 */
function dedupHash(type, problem) {
  const input = `${type}:${(problem || '').slice(0, 200)}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Append a corpus entry to a JSONL file. Checks last N entries for duplicates.
 * Creates parent directory if needed. Returns the entry that was written (or null if dupe).
 */
function appendToJsonl(filePath, entry, checkLastN = LAST_N_DEDUP) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Read last N entries for dedup
    let existing = [];
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      existing = lines.slice(-checkLastN).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    }

    // Check for duplicate by hash
    const hash = entry.hash || dedupHash(entry.type, entry.problem);
    if (existing.some(e => e.hash === hash)) {
      return null; // duplicate — skip
    }

    entry.hash = hash;
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
    return entry;
  } catch (err) {
    console.error('[corpus-utils] appendToJsonl error:', err.message);
    return null;
  }
}

/**
 * Append a corpus entry to BOTH the per-workspace and global corpus files.
 *
 * @param {string} type - e.g. 'build_failure', 'stuck_loop', 'tool_error'
 * @param {string} problem - short description of the problem
 * @param {string} context - additional context (file paths, iteration count, etc.)
 * @param {string} resolution - how it was resolved (can be empty string if unresolved)
 * @param {string} workspaceId - workspace identifier
 * @returns {object|null} the appended entry, or null if duplicate
 */
export function appendCorpusEntry(type, problem, context = '', resolution = '', workspaceId = '') {
  const hash = dedupHash(type, problem);
  const entry = {
    type,
    problem,
    context,
    resolution,
    workspaceId,
    resolved: !!resolution,
    timestamp: new Date().toISOString(),
    hash
  };

  // Write to global corpus
  const globalPath = getGlobalCorpusPath();
  appendToJsonl(globalPath, entry, MAX_GLOBAL_ENTRIES);

  // Prune global corpus if too large (keep last MAX_GLOBAL_ENTRIES)
  try {
    if (fs.existsSync(globalPath)) {
      const raw = fs.readFileSync(globalPath, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      if (lines.length > MAX_GLOBAL_ENTRIES) {
        fs.writeFileSync(globalPath, lines.slice(-MAX_GLOBAL_ENTRIES).join('\n') + '\n', 'utf-8');
      }
    }
  } catch {}

  // Write to per-workspace corpus if workspaceId is provided
  if (workspaceId) {
    try {
      // workspaceId may be a UUID or the full path; construct path
      const wsDir = workspaceId.includes('/') ? workspaceId : path.join(process.cwd(), '.workspaces', workspaceId);
      const wsPath = getWorkspaceCorpusPath(wsDir);
      if (fs.existsSync(path.dirname(wsPath)) || workspaceId.includes('/')) {
        appendToJsonl(wsPath, entry);
      }
    } catch {}
  }

  return entry;
}

/**
 * Load recent corpus entries, merging per-workspace and global.
 *
 * @param {string} wsDir - workspace directory path
 * @param {number} limit - max entries to return
 * @returns {Array} sorted by timestamp descending, newest first
 */
export function loadRecentCorpus(wsDir, limit = 20) {
  const entries = [];
  const seenHashes = new Set();

  const readEntries = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.hash && !seenHashes.has(entry.hash)) {
            seenHashes.add(entry.hash);
            entries.push(entry);
          }
        } catch {}
      }
    } catch {}
  };

  // Read per-workspace first (more specific), then global
  if (wsDir) {
    readEntries(getWorkspaceCorpusPath(wsDir));
  }
  readEntries(getGlobalCorpusPath());

  // Sort by timestamp descending
  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return entries.slice(0, limit);
}

/**
 * Mark a corpus entry as resolved (update resolution text).
 * Searches both per-workspace and global files.
 *
 * @param {string} wsDir - workspace directory
 * @param {string} entryHash - hash of the entry to resolve
 * @param {string} resolution - how the problem was resolved
 */
export function markResolved(wsDir, entryHash, resolution) {
  const updateFile = (filePath) => {
    if (!fs.existsSync(filePath)) return false;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const lines = raw.trim().split('\n');
      let updated = false;
      const newLines = lines.map(line => {
        try {
          const entry = JSON.parse(line);
          if (entry.hash === entryHash) {
            entry.resolved = true;
            entry.resolution = resolution;
            entry.resolvedAt = new Date().toISOString();
            updated = true;
            return JSON.stringify(entry);
          }
        } catch {}
        return line;
      });
      if (updated) {
        fs.writeFileSync(filePath, newLines.join('\n') + '\n', 'utf-8');
      }
      return updated;
    } catch { return false; }
  };

  // Always update BOTH per-workspace AND global corpuses.
  // Don't short-circuit — if the entry exists in both, both must be marked resolved.
  // Otherwise resolved entries vanish when the workspace is deleted.
  let updated = false;
  if (wsDir) {
    updated = updateFile(getWorkspaceCorpusPath(wsDir)) || updated;
  }
  updated = updateFile(getGlobalCorpusPath()) || updated;
  return updated;
}

/**
 * Get the last unresolved entry of a specific type from a workspace.
 */
export function getLastUnresolved(wsDir, type) {
  const entries = loadRecentCorpus(wsDir, 100);
  return entries.find(e => e.type === type && !e.resolved) || null;
}
