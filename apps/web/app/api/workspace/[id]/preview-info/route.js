// @aurora/api/workspace/[id]/preview-info - Detect project type and preview config

import { NextResponse } from 'next/server';
import { validateWorkspace } from '../../../../../lib/workspace-utils';
import fs from 'fs';
import path from 'path';

/**
 * Detect the project type from a workspace directory.
 * Returns project metadata for previewing/running the app.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    
    const wsDir = validateWorkspace(id);
    if (!wsDir) {
      return NextResponse.json({ error: { message: 'Workspace not found' } }, { status: 404 });
    }
    
    const files = fs.readdirSync(wsDir);
    
    // Check for package.json
    const packageJsonPath = path.join(wsDir, 'package.json');
    let packageJson = null;
    if (fs.existsSync(packageJsonPath)) {
      try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      } catch {}
    }
    
    // Detect project type
    let type = 'none';
    let port = null;
    let framework = null;
    let suggestedCommand = null;
    
    if (packageJson) {
      const allScripts = { 
        ...(packageJson.scripts || {}), 
        ...(packageJson.devDependencies || {}),
        ...(packageJson.dependencies || {})
      };
      const scriptKeys = Object.keys(packageJson.scripts || {});
      const deps = { 
        ...(packageJson.dependencies || {}), 
        ...(packageJson.devDependencies || {}) 
      };
      const depNames = Object.keys(deps);
      
      // Next.js detection
      const hasNextConfig = files.some(f => f.startsWith('next.config.'));
      if (hasNextConfig || depNames.includes('next')) {
        type = 'nextjs';
        port = 3001;  // 3000 is the Aurora app itself
        framework = 'Next.js';
        suggestedCommand = scriptKeys.includes('dev') ? 'npm run dev' : 'npx next dev';
      }
      // Vite detection
      else if (depNames.includes('vite')) {
        type = 'vite';
        port = 5173;
        framework = 'Vite';
        suggestedCommand = scriptKeys.includes('dev') ? 'npm run dev' : 'npx vite';
      }
      // Create React App
      else if (depNames.includes('react-scripts')) {
        type = 'react';
        port = 3001;  // 3000 is the Aurora app itself
        framework = 'Create React App';
        suggestedCommand = scriptKeys.includes('start') ? 'npm start' : 'npx react-scripts start';
      }
      // Generic Node.js server
      else if (scriptKeys.includes('start') || scriptKeys.includes('dev')) {
        type = 'node';
        port = null;
        framework = 'Node.js';
        suggestedCommand = scriptKeys.includes('dev') ? 'npm run dev' : 'npm start';
      }
    }
    
    // Fallback: check for static index.html
    if (type === 'none' && files.includes('index.html')) {
      type = 'static';
      port = null;
      framework = 'Static Site';
      suggestedCommand = null;
    }
    
    // Check if node_modules exists (dependencies installed)
    const nodeModulesExist = fs.existsSync(path.join(wsDir, 'node_modules'));
    
    const result = {
      type,
      framework,
      port,
      suggestedCommand,
      nodeModulesInstalled: nodeModulesExist,
      hasScripts: packageJson ? Object.keys(packageJson.scripts || {}) : [],
      urls: port ? [`http://localhost:${port}`] : []
    };
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('[workspace/preview-info] Error:', error.message);
    return NextResponse.json({ error: { message: 'Failed to detect project type' } }, { status: 500 });
  }
}
