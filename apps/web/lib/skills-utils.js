// @aurora/web - Skills utilities for agent-learned reusable patterns
//
// Skills are markdown files with YAML frontmatter stored in BOTH:
//   1. {wsDir}/.aurora/skills/  — per-workspace (tied to workspace lifecycle)
//   2. ~/.aurora/skills/         — global (survives workspace deletions)
//
// This dual-scope design ensures skills persist across workspace deletions,
// similar to how the corpus system uses global + per-workspace JSONL files.
//
// The agent creates them after successful builds to capture reusable patterns.
// They are injected into the system prompt when relevant to the current request.
//
// Frontmatter format:
// ---
// name: Pattern Name
// description: What this skill covers
// applyTo: keyword1, keyword2, keyword3
// ---
// Markdown instructions here...

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Get the global skills directory (~/.aurora/skills/).
 */
export function getGlobalSkillsDir() {
  return path.join(os.homedir(), '.aurora', 'skills');
}

/**
 * Get the skills directory for a workspace.
 */
export function getSkillsDir(wsDir) {
  return path.join(wsDir, '.aurora', 'skills');
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { frontmatter: {}, body: string } or null if no frontmatter.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return null;

  const rawYaml = match[1];
  const body = match[2];

  // Simple YAML parser (supports key: value, key: "value", key: 'value')
  const frontmatter = {};
  const lines = rawYaml.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Load all skills from a workspace's .aurora/skills/ directory.
 *
 * @param {string} wsDir - workspace directory
 * @returns {Array<{name, description, applyTo, content, path}>}
 */
export function loadAllSkills(wsDir) {
  const skillsDir = getSkillsDir(wsDir);
  const skills = [];

  if (!fs.existsSync(skillsDir)) return skills;

  try {
    const files = fs.readdirSync(skillsDir);
    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
      if (file === 'README.md') continue;

      const filePath = path.join(skillsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseFrontmatter(content);

        if (parsed) {
          skills.push({
            name: parsed.frontmatter.name || file.replace(/\.mdx?$/, ''),
            description: parsed.frontmatter.description || '',
            applyTo: (parsed.frontmatter.applyTo || '').split(',').map(s => s.trim()).filter(Boolean),
            content: parsed.body,
            path: filePath
          });
        } else {
          // No frontmatter — use filename as name, full content as body
          skills.push({
            name: file.replace(/\.mdx?$/, ''),
            description: '',
            applyTo: [],
            content,
            path: filePath
          });
        }
      } catch (err) {
        console.error(`[skills-utils] Error reading skill ${file}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[skills-utils] loadAllSkills error:', err.message);
  }

  return skills;
}

/**
 * Create a new skill markdown file.
 *
 * @param {string} wsDir - workspace directory
 * @param {string} name - skill name (human-readable)
 * @param {string} description - what this skill covers
 * @param {string} applyTo - comma-separated keywords for matching
 * @param {string} content - markdown body of the skill
 * @returns {{ success: boolean, path?: string, error?: string }}
 */
export function createSkill(wsDir, name, description, applyTo, content) {
  try {
    const skillsDir = getSkillsDir(wsDir);
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    // Sanitize name to filename
    const filename = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) + '.md';

    const filePath = path.join(skillsDir, filename);

    // Don't overwrite existing — append numeric suffix
    let finalPath = filePath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const base = filename.replace(/\.md$/, '');
      finalPath = path.join(skillsDir, `${base}-${counter}.md`);
      counter++;
      if (counter > 10) {
        return { success: false, error: 'Too many skills with this name' };
      }
    }

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `applyTo: ${applyTo}`,
      `created: ${new Date().toISOString()}`,
      '---',
      '',
      content
    ].join('\n');

    fs.writeFileSync(finalPath, frontmatter, 'utf-8');
    return { success: true, path: finalPath };
  } catch (err) {
    console.error('[skills-utils] createSkill error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Load all skills from the global skills directory (~/.aurora/skills/).
 * These survive workspace deletions — the persistent skill library.
 *
 * @returns {Array<{name, description, applyTo, content, path, scope: 'global'}>}
 */
export function loadAllGlobalSkills() {
  const skillsDir = getGlobalSkillsDir();
  const skills = [];

  if (!fs.existsSync(skillsDir)) return skills;

  try {
    const files = fs.readdirSync(skillsDir);
    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
      if (file === 'README.md') continue;

      const filePath = path.join(skillsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseFrontmatter(content);

        if (parsed) {
          skills.push({
            name: parsed.frontmatter.name || file.replace(/\.mdx?$/, ''),
            description: parsed.frontmatter.description || '',
            applyTo: (parsed.frontmatter.applyTo || '').split(',').map(s => s.trim()).filter(Boolean),
            content: parsed.body,
            contentPreview: parsed.body.slice(0, 200),
            path: filePath,
            scope: 'global'
          });
        } else {
          skills.push({
            name: file.replace(/\.mdx?$/, ''),
            description: '',
            applyTo: [],
            content,
            contentPreview: content.slice(0, 200),
            path: filePath,
            scope: 'global'
          });
        }
      } catch (err) {
        console.error(`[skills-utils] Error reading global skill ${file}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[skills-utils] loadAllGlobalSkills error:', err.message);
  }

  return skills;
}

/**
 * Create a skill in the GLOBAL skills directory (~/.aurora/skills/).
 * Global skills survive workspace deletions — use this for patterns that
 * are universally applicable (build fixes, framework conventions, etc.)
 *
 * @param {string} name - skill name (human-readable)
 * @param {string} description - what this skill covers
 * @param {string} applyTo - comma-separated keywords for matching
 * @param {string} content - markdown body of the skill
 * @returns {{ success: boolean, path?: string, error?: string }}
 */
export function createGlobalSkill(name, description, applyTo, content) {
  try {
    const skillsDir = getGlobalSkillsDir();
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const filename = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) + '.md';

    const filePath = path.join(skillsDir, filename);

    let finalPath = filePath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const base = filename.replace(/\.md$/, '');
      finalPath = path.join(skillsDir, `${base}-${counter}.md`);
      counter++;
      if (counter > 10) {
        return { success: false, error: 'Too many skills with this name' };
      }
    }

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `applyTo: ${applyTo}`,
      `created: ${new Date().toISOString()}`,
      '---',
      '',
      content
    ].join('\n');

    fs.writeFileSync(finalPath, frontmatter, 'utf-8');
    return { success: true, path: finalPath };
  } catch (err) {
    console.error('[skills-utils] createGlobalSkill error:', err.message);
    return { success: false, error: err.message };
  }
}
export function deleteSkill(wsDir, skillName) {
  try {
    const skillsDir = getSkillsDir(wsDir);
    if (!fs.existsSync(skillsDir)) return { success: false, error: 'Skills directory not found' };

    const skills = loadAllSkills(wsDir);
    const skill = skills.find(s => s.name === skillName || path.basename(s.path) === skillName);
    if (!skill) return { success: false, error: 'Skill not found' };

    fs.unlinkSync(skill.path);
    return { success: true };
  } catch (err) {
    console.error('[skills-utils] deleteSkill error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Check if a skill's applyTo keywords match the user's request.
 * Simple keyword-based matching: any applyTo keyword appears as a substring
 * in the request (case-insensitive).
 *
 * @param {object} skill - skill object with applyTo array
 * @param {string} userRequest - the user's message/request
 * @returns {boolean}
 */
export function skillMatchesRequest(skill, userRequest) {
  if (!skill.applyTo || skill.applyTo.length === 0) {
    // Skills with no applyTo keywords are always relevant (general patterns)
    return true;
  }

  const requestLower = (userRequest || '').toLowerCase();
  return skill.applyTo.some(keyword =>
    requestLower.includes(keyword.toLowerCase())
  );
}
