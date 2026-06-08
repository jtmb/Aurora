// @aurora/web - FileTree component for workspace file explorer

'use client';

import { useState, useMemo } from 'react';

const STATUS_COLORS = {
  'M': 'text-amber-400',
  'A': 'text-green-400',
  'D': 'text-red-400',
  'R': 'text-purple-400',
  '?': 'text-emerald-400',
  'U': 'text-emerald-400',
};

export default function FileTree({ tree, onFileClick, activeFile, searchQuery, onSearchChange, gitStatus, onDeleteFile }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set());

  const toggleFolder = (folderPath) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  // Filter tree based on search query
  const filteredTree = useMemo(() => {
    if (!searchQuery || !searchQuery.trim()) return tree;
    const q = searchQuery.toLowerCase();
    
    const filterNodes = (nodes) => {
      const result = [];
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(q)) {
          result.push(node);
        } else if (node.type === 'directory' && node.children) {
          const filteredChildren = filterNodes(node.children);
          if (filteredChildren.length > 0) {
            result.push({ ...node, children: filteredChildren });
          }
        }
      }
      return result;
    };
    
    return filterNodes(tree);
  }, [tree, searchQuery]);

  // Auto-expand matching folders when searching
  useMemo(() => {
    if (searchQuery && searchQuery.trim()) {
      const newExpanded = new Set(expandedFolders);
      const addFolders = (nodes) => {
        for (const node of nodes) {
          if (node.type === 'directory') {
            newExpanded.add(node.path);
            if (node.children) addFolders(node.children);
          }
        }
      };
      addFolders(filteredTree);
      setExpandedFolders(newExpanded);
    }
  }, [searchQuery]);

  const getFileIcon = (node) => {
    if (node.type === 'directory') {
      const isExpanded = expandedFolders.has(node.path);
      return (
        <svg className="w-3.5 h-3.5 flex-shrink-0 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isExpanded ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          )}
        </svg>
      );
    }
    // File icons by extension
    const lang = node.language || '';
    if (['javascript', 'typescript'].includes(lang)) {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-amber-400 text-[9px] font-bold text-center leading-[14px]">JS</span>;
    }
    if (lang === 'css' || lang === 'scss') {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-sky-400 text-[9px] font-bold text-center leading-[14px]">#</span>;
    }
    if (lang === 'html') {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-orange-400 text-[9px] font-bold text-center leading-[14px]">&lt;&gt;</span>;
    }
    if (lang === 'json') {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-yellow-400 text-[9px] font-bold text-center leading-[14px]">{'{ }'}</span>;
    }
    if (lang === 'python') {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-blue-400 text-[9px] font-bold text-center leading-[14px]">Py</span>;
    }
    if (lang === 'rust') {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-orange-500 text-[9px] font-bold text-center leading-[14px]">Rs</span>;
    }
    if (lang === 'go') {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-cyan-400 text-[9px] font-bold text-center leading-[14px]">Go</span>;
    }
    if (lang === 'markdown') {
      return <span className="w-3.5 h-3.5 flex-shrink-0 text-blue-300 text-[9px] font-bold text-center leading-[14px]">MD</span>;
    }
    // Default file icon
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  };

  // Build git status lookup map: path -> status letter
  const gitStatusMap = useMemo(() => {
    if (!gitStatus?.files) return {};
    const map = {};
    for (const f of gitStatus.files) {
      const idx = f.index || ' ';
      const wd = f.workingDir || ' ';
      // Priority: staged status > working dir status
      if (idx !== ' ' && idx !== '?') {
        map[f.path] = idx;
      } else if (wd !== ' ' && wd !== '?') {
        map[f.path] = wd;
      } else if (idx === '?' || wd === '?') {
        map[f.path] = '?';
      }
    }
    return map;
  }, [gitStatus]);

  // Check if any descendant of a directory has git changes
  const hasChangedChildren = useMemo(() => {
    const check = (nodes) => {
      const set = new Set();
      for (const node of nodes) {
        if (node.type === 'directory' && node.children) {
          const childResults = check(node.children);
          if (childResults.has(node.path) || childResults.size > 0) {
            set.add(node.path);
            for (const r of childResults) set.add(r);
          }
        } else if (gitStatusMap[node.path]) {
          // Find all ancestor paths
          const parts = node.path.split('/');
          for (let i = 0; i < parts.length; i++) {
            set.add(parts.slice(0, i + 1).join('/'));
          }
        }
      }
      return set;
    };
    return check(tree);
  }, [tree, gitStatusMap]);

  const renderNode = (node, depth = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = activeFile === node.path;
    const paddingLeft = depth * 16 + 8;

    if (node.type === 'directory') {
      const hasChanges = hasChangedChildren.has(node.path);
      return (
        <div key={node.path}>
          <div
            onClick={() => toggleFolder(node.path)}
            className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-zinc-800/60 text-xs transition-colors select-none ${
              hasChanges ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            style={{ paddingLeft: `${paddingLeft}px` }}
          >
            <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {getFileIcon(node)}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && node.children?.map(child => renderNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        onClick={() => onFileClick(node)}
        className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer text-xs transition-colors select-none ${
          isActive
            ? 'bg-indigo-600/15 text-indigo-300 border-l-2 border-indigo-500'
            : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40 border-l-2 border-transparent'
        }`}
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        {getFileIcon(node)}
        {/* Git status badge */}
        {gitStatusMap[node.path] && (
          <span className={`w-3 text-center font-mono text-[9px] font-bold ${STATUS_COLORS[gitStatusMap[node.path]] || 'text-zinc-400'}`}>
            {gitStatusMap[node.path] === '?' ? 'U' : gitStatusMap[node.path]}
          </span>
        )}
        <span className="truncate flex-1">{node.name}</span>
        {/* Delete button — appears on hover */}
        {onDeleteFile && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${node.name}"?`)) {
                onDeleteFile(node);
              }
            }}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all"
            title="Delete file"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900/80 border-r border-zinc-800/40">
      {/* Search bar */}
      <div className="p-2 border-b border-zinc-800/40">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery || ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg pl-7 pr-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
          />
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredTree.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-zinc-600">
              {searchQuery ? 'No matching files' : 'Empty workspace'}
            </p>
          </div>
        ) : (
          filteredTree.map(node => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}
