// @aurora/web - Workspace utilities for file system and git operations

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Directory where all workspaces are stored */
export function getWorkspacesDir() {
  return path.join(os.homedir(), '.aurora', 'workspaces');
}

/** Get the absolute path to a specific workspace */
export function getWorkspaceDir(workspaceId) {
  return path.join(getWorkspacesDir(), workspaceId);
}

/**
 * Resolve a user-requested file path safely within a workspace directory.
 * Returns null if the resolved path escapes the workspace (path traversal attempt).
 */
export function resolveSafePath(workspaceDir, requestedPath) {
  // Normalize: strip leading slashes, resolve relative to workspace
  const sanitized = requestedPath.replace(/^[\/\\]+/, '').replace(/\.\./g, '');
  const resolved = path.resolve(workspaceDir, sanitized);
  // Verify resolved path is still within workspaceDir
  if (!resolved.startsWith(workspaceDir + path.sep) && resolved !== workspaceDir) {
    return null;
  }
  return resolved;
}

/**
 * Ensure the workspaces directory exists, creating it if needed.
 */
export function ensureWorkspacesDir() {
  const dir = getWorkspacesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Map file extension to a language identifier for Monaco.
 * Falls back to plaintext for unknown extensions.
 */
export function getFileLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'html', '.htm': 'html',
    '.json': 'json', '.jsonc': 'json',
    '.md': 'markdown', '.mdx': 'markdown',
    '.py': 'python', '.rb': 'ruby', '.php': 'php',
    '.java': 'java', '.kt': 'kotlin', '.scala': 'scala',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.rs': 'rust', '.go': 'go',
    '.swift': 'swift',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.yaml': 'yaml', '.yml': 'yaml',
    '.xml': 'xml', '.svg': 'xml',
    '.sql': 'sql',
    '.graphql': 'graphql', '.gql': 'graphql',
    '.dockerfile': 'dockerfile',
    '.env': 'plaintext', '.gitignore': 'plaintext',
    '.prisma': 'graphql',
    '.toml': 'ini',
    '.vue': 'html', '.svelte': 'html',
  };
  return map[ext] || 'plaintext';
}

/**
 * Walk a directory recursively and return a tree structure.
 * Limits depth and skips common ignore patterns.
 */
export function walkDirectory(dirPath, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];
  
  const IGNORE_PATTERNS = [
    'node_modules', '.git', '.next', '__pycache__', '.DS_Store',
    'dist', 'build', '.turbo', '.cache', 'coverage', '.nyc_output'
  ];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const results = [];
    
    for (const entry of entries) {
      if (IGNORE_PATTERNS.includes(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(getWorkspacesDir(), fullPath);
      // Strip workspace ID prefix to get path relative to workspace root
      const parts = relativePath.split(path.sep);
      const workspaceRelative = parts.slice(1).join('/') || entry.name;
      
      if (entry.isDirectory()) {
        const children = walkDirectory(fullPath, maxDepth, currentDepth + 1);
        if (children.length > 0 || currentDepth < 3) {
          results.push({
            name: entry.name,
            path: workspaceRelative,
            type: 'directory',
            children
          });
        }
      } else {
        // Skip binary/large files by extension
        const ext = path.extname(entry.name).toLowerCase();
        const skipExts = new Set([
          '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp',
          '.woff', '.woff2', '.ttf', '.eot', '.otf',
          '.mp3', '.mp4', '.avi', '.mov', '.webm',
          '.zip', '.tar', '.gz', '.7z', '.rar',
          '.pdf', '.doc', '.docx', '.ppt', '.pptx',
          '.exe', '.dll', '.so', '.dylib',
        ]);
        if (skipExts.has(ext)) continue;
        
        results.push({
          name: entry.name,
          path: workspaceRelative,
          type: 'file',
          language: getFileLanguage(entry.name)
        });
      }
    }
    
    // Sort: directories first, then files, both alphabetically
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    
    return results;
  } catch (err) {
    return [];
  }
}

/**
 * Validate workspace exists and return its path.
 * Returns null if workspace doesn't exist.
 */
export function validateWorkspace(workspaceId) {
  const dir = getWorkspaceDir(workspaceId);
  if (!fs.existsSync(dir)) return null;
  return dir;
}
