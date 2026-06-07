// Focused test of the fallback parser logic
// Tests the regex patterns against the exact model output format

// Simulate the exact model output seen in the terminal
const modelOutput = `
[x] Task 1: Create package.json with all required dependencies

\`\`\`json
{
  "name": "todo-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  },
  "dependencies": {
    "next": "^15.0.0"
  }
}
\`\`\`

[x] Task 2: Create the main page component

\`\`\`tsx
import React from 'react';

export default function HomePage() {
  return <div>Hello World</div>;
}
\`\`\`
`;

// The KNOWN_TOOL_NAMES set
const KNOWN_TOOL_NAMES = new Set([
  'list_dir','read_file','grep_search','create_file','replace_string_in_file',
  'run_in_terminal','dev_server_status','dev_server_start','dev_server_stop',
  'show_preview','create_skill'
]);

// The FILE_LANGS set from the fallback
const FILE_LANGS = new Set([
  'json', 'typescript', 'ts', 'tsx', 'js', 'jsx',
  'css', 'scss', 'less', 'html', 'yaml', 'yml', 'toml',
  'md', 'markdown', 'py', 'sql', 'graphql', 'gql'
]);

// The exact fallback regex and logic from agent-runner.js
function testFallback(content) {
  const calls = [];
  
  if (content.includes('```')) {
    const genericBlockRegex = /```(\w+)\s*\n([\s\S]*?)```/g;
    let gbMatch;
    
    while ((gbMatch = genericBlockRegex.exec(content)) !== null) {
      const lang = gbMatch[1].toLowerCase();
      const body = gbMatch[2].trim();
      console.log(`\nFound block: lang="${lang}", body preview="${body.slice(0, 60)}..."`);
      
      if (!body) { console.log('  SKIP: empty body'); continue; }
      if (KNOWN_TOOL_NAMES.has(lang)) { console.log(`  SKIP: "${lang}" is a tool name`); continue; }
      if (!FILE_LANGS.has(lang)) { console.log(`  SKIP: "${lang}" not in FILE_LANGS`); continue; }
      
      console.log(`  PASS: lang "${lang}" is valid file language`);

      // Try to extract file path from text before this block
      const beforeText = content.slice(0, gbMatch.index);
      console.log(`  beforeText: "${beforeText.slice(-80)}"`);
      
      let filePath = null;

      const pathPatterns = [
        /(?:Create|create|Write|write|file|File|path|Path)\s*[`:]\s*`([^`]+)`/,
        /(?:Create|create|Write|write)\s+`([^`]+)`/,
        /`([^`]+\.(?:tsx?|jsx?|css|scss|html|json|yaml|yml|md|py|sql))`/,
        /(?:file|File|path|Path)\s*[=:]\s*["']([^"']+)["']/,
        /(?:Create|create|Write|write|file|File|path|Path)\s+([^\s`"']+\.(?:tsx?|jsx?|css|scss|less|html|json|yaml|yml|md|py|sql))/i,
        /([^\s`"']+\.(?:tsx?|jsx?|css|scss|less|html|json|yaml|yml|md|py|sql))/i,
      ];

      for (const pattern of pathPatterns) {
        const matches = [...beforeText.matchAll(new RegExp(pattern.source, 'gi'))];
        if (matches.length > 0) {
          filePath = matches[matches.length - 1][1];
          console.log(`  Path found via pattern ${pathPatterns.indexOf(pattern)}: "${filePath}"`);
          break;
        }
      }

      // If no path found, try to infer from content
      if (!filePath) {
        console.log('  No path found in beforeText, trying inference...');
        if (lang === 'json') {
          try {
            const parsed = JSON.parse(body);
            if (parsed.name && (parsed.scripts || parsed.dependencies || parsed.devDependencies)) {
              filePath = 'package.json';
              console.log('  Inferred: package.json from JSON structure');
            } else if (parsed.compilerOptions !== undefined) {
              filePath = 'tsconfig.json';
              console.log('  Inferred: tsconfig.json from JSON structure');
            }
          } catch (e) { console.log(`  JSON parse failed: ${e.message}`); }
        } else if (lang === 'typescript' || lang === 'ts') {
          const exportMatch = body.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
          if (exportMatch) { filePath = `src/${exportMatch[1]}.ts`; console.log(`  Inferred: ${filePath}`); }
        } else if (lang === 'tsx' || lang === 'jsx') {
          const exportMatch = body.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
          if (exportMatch) { filePath = `src/${exportMatch[1]}.tsx`; console.log(`  Inferred: ${filePath}`); }
        }
      }

      if (!filePath) {
        console.log('  FAIL: No filePath could be determined');
        continue;
      }

      console.log(`  SUCCESS: create_file filePath="${filePath}"`);
      calls.push({
        name: 'create_file',
        args: { filePath, content: body },
      });
    }
  }
  
  return calls;
}

console.log('=== Testing fallback parser against actual model output ===\n');
console.log('Raw content length:', modelOutput.length);
console.log('Contains backticks:', modelOutput.includes('```'));
console.log();

const result = testFallback(modelOutput);
console.log(`\n=== Total create_file calls: ${result.length} ===`);
for (const c of result) {
  console.log(`  create_file: ${c.args.filePath} (${c.args.content.length} chars)`);
}
