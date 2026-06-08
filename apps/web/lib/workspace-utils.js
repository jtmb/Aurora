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
 * When userId is provided, also checks workspace ownership.
 * Workspaces without an ownerId (legacy) are accessible to all users.
 * Returns null if workspace doesn't exist or user doesn't own it.
 */
export function validateWorkspace(workspaceId, userId) {
  const dir = getWorkspaceDir(workspaceId);
  if (!fs.existsSync(dir)) return null;
  // Ownership check (only when userId is provided)
  if (userId) {
    const metaPath = path.join(dir, '.aurora', 'workspace.json');
    if (fs.existsSync(metaPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        // If ownerId is set and doesn't match, deny access
        if (metadata.ownerId && metadata.ownerId !== userId) return null;
      } catch { /* corrupt metadata — allow access */ }
    }
    // No metadata or no ownerId set → allow (backward compat with pre-ownership workspaces)
  }
  return dir;
}

/**
 * Read workspace metadata from .aurora/workspace.json.
 * Returns {} if no metadata file exists, null if workspace doesn't exist.
 */
export function readWorkspaceMetadata(workspaceId) {
  const dir = getWorkspaceDir(workspaceId);
  if (!fs.existsSync(dir)) return null;
  const metaPath = path.join(dir, '.aurora', 'workspace.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write workspace metadata to .aurora/workspace.json.
 * Creates the .aurora directory if it doesn't exist.
 */
export function writeWorkspaceMetadata(workspaceId, metadata) {
  const dir = getWorkspaceDir(workspaceId);
  if (!fs.existsSync(dir)) return false;
  const auroraDir = path.join(dir, '.aurora');
  if (!fs.existsSync(auroraDir)) {
    fs.mkdirSync(auroraDir, { recursive: true });
  }
  const metaPath = path.join(auroraDir, 'workspace.json');
  try {
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the project framework from a workspace directory and update/append
 * framework-specific guidance to AGENTS.md. Only writes if the file doesn't
 * already have a framework section (idempotent).
 *
 * Returns the detected framework name, or null if unknown.
 */
export function ensureAgentsMd(wsDir) {
  try {
    const files = fs.readdirSync(wsDir);
    const agentsPath = path.join(wsDir, 'AGENTS.md');
    const claudePath = path.join(wsDir, 'CLAUDE.md');

    // Check for package.json
    const pkgPath = path.join(wsDir, 'package.json');
    let pkg = null;
    if (fs.existsSync(pkgPath)) {
      try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch {}
    }

    let framework = null;
    let section = '';

    // --- FRAMEWORK DETECTION ---
    if (pkg) {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const depNames = Object.keys(deps);
      const scripts = Object.keys(pkg.scripts || {});
      const hasNextConfig = files.some(f => f.startsWith('next.config.'));

      if (hasNextConfig || depNames.includes('next')) {
        framework = 'Next.js';
        section = `
## Next.js Project

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in \`node_modules/next/dist/docs/\` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

- **Version**: Use \`"next": "^15.0.3"\` in package.json. NEVER use "latest" — it causes unpredictable install failures.
- **React**: \`"react": "^19.0.0"\`, \`"react-dom": "^19.0.0"\`.
- **Typescript**: Use \`"typescript": "~5.6.0"\` (NOT "latest").
- **App Router**: Use \`app/\` directory with \`page.tsx\`/\`layout.tsx\`, not \`pages/\`.
- **Dev command**: \`${scripts.includes('dev') ? 'npm run dev' : 'npx next dev'}\`
- **Port**: Default 3000, auto-assigned to avoid conflicts.
- **Deps**: \`npm install --legacy-peer-deps\` runs automatically if node_modules is missing.
- **TypeScript**: Next.js auto-installs TypeScript deps when it detects \`tsconfig.json\`.
- **Tailwind v3** (use v3 \`tailwindcss@^3\`, NOT v4):
  - REQUIRES \`postcss.config.mjs\` with \`tailwindcss\` and \`autoprefixer\` plugins
  - REQUIRES \`tailwind.config.js\` scanning \`./app/**/*.{js,ts,jsx,tsx}\`
  - CSS MUST use \`@tailwind base;\\n@tailwind components;\\n@tailwind utilities;\` (NEVER \`@import "tailwindcss"\` — that's v4 syntax)
- **"use client"**: REQUIRED in any file using \`useState\`, \`useEffect\`, \`onClick\`, framer-motion, or lucide-react icons.
`;
      } else if (depNames.includes('vite')) {
        framework = 'Vite';
        section = `
## Vite Project

- **Dev command**: \`${scripts.includes('dev') ? 'npm run dev' : 'npx vite'}\`
- **Port**: Default 5173, auto-assigned to avoid conflicts.
- **Build**: \`npm run build\` then serve \`dist/\` with \`npx serve dist\`.
- **Framework variants**: Check \`vite.config\` for React/Svelte/Vue plugin.
`;
      } else if (depNames.includes('react-scripts')) {
        framework = 'Create React App';
        section = `
## Create React App Project

- **Dev command**: \`${scripts.includes('start') ? 'npm start' : 'npx react-scripts start'}\`
- **Port**: Default 3000, auto-assigned.
- **Build**: \`npm run build\` then serve \`build/\`.
`;
      } else if (scripts.includes('start') || scripts.includes('dev')) {
        framework = 'Node.js';
        section = `
## Node.js Project

- **Dev command**: \`${scripts.includes('dev') ? 'npm run dev' : 'npm start'}\`
- **Runtime**: Node.js v22.22.3, npm 10.9.8.
- **Deps**: \`npm install\` runs automatically if node_modules is missing.
`;
      }
    }

    // Python detection
    if (!framework) {
      if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('setup.py')) {
        framework = 'Python';
        section = `
## Python Project

- **Runtime**: Python 3.12.3
- **Virtual env**: Create with \`python3 -m venv .venv\` and activate with \`source .venv/bin/activate\`.
- **Install deps**: \`pip install -r requirements.txt\` (or \`pip install -e .\` for pyproject.toml).
- **Dev server**: \`python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000\` (FastAPI) or \`python -m flask run --port 8000\` (Flask).
- **Port**: Default 8000 for web frameworks.
`;
      }
    }

    // Go detection
    if (!framework && files.includes('go.mod')) {
      framework = 'Go';
      section = `
## Go Project

- **Runtime**: Use \`go version\` to check. Module in \`go.mod\`.
- **Install deps**: \`go mod tidy\`
- **Run**: \`go run .\` or \`go run main.go\`
- **Build**: \`go build -o bin/app .\`
`;
    }

    // Rust detection
    if (!framework && files.includes('Cargo.toml')) {
      framework = 'Rust';
      section = `
## Rust Project

- **Runtime**: Use \`rustc --version\` to check.
- **Build**: \`cargo build\`
- **Run**: \`cargo run\`
- **Dev**: \`cargo watch -x run\` (install with \`cargo install cargo-watch\`)
`;
    }

    // Static site detection
    if (!framework && files.includes('index.html')) {
      framework = 'Static Site';
      section = `
## Static Site

- **Serve**: \`npx serve . --no-clipboard\`
- **Port**: Auto-assigned by serve.
- No build step needed — files are served directly.
`;
    }

    // Write framework section if detected
    if (framework && section) {
      // Check if AGENTS.md already has a framework section
      const existingContent = fs.existsSync(agentsPath)
        ? fs.readFileSync(agentsPath, 'utf-8')
        : fs.existsSync(claudePath)
          ? fs.readFileSync(claudePath, 'utf-8')
          : '';

      // Only append if no framework section exists yet
      if (existingContent && !existingContent.includes(`## ${framework} Project`)) {
        fs.appendFileSync(agentsPath, section);
      }
    }

    return framework;
  } catch (err) {
    console.error('[workspace-utils] ensureAgentsMd error:', err.message);
    return null;
  }
}
