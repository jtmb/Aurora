// @aurora/web - Monaco-based code editor with Aurora dark theme

'use client';

import { useRef, useCallback, useEffect } from 'react';
import Editor, { loader } from '@monaco-editor/react';

// Define the Aurora dark theme
const AURORA_DARK_THEME = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C586C0' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'variable', foreground: '9CDCFE' },
    { token: 'constant', foreground: '4FC1FF' },
    { token: 'operator', foreground: 'D4D4D4' },
    { token: 'delimiter', foreground: 'D4D4D4' },
    { token: 'tag', foreground: '569CD6' },
    { token: 'attribute.name', foreground: '9CDCFE' },
    { token: 'attribute.value', foreground: 'CE9178' },
  ],
  colors: {
    'editor.background': '#0a0a0a',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#18181b80',
    'editor.selectionBackground': '#6366f140',
    'editor.inactiveSelectionBackground': '#6366f120',
    'editorCursor.foreground': '#6366f1',
    'editorLineNumber.foreground': '#52525b',
    'editorLineNumber.activeForeground': '#a1a1aa',
    'editor.selectionHighlightBackground': '#6366f120',
    'editor.findMatchBackground': '#6366f140',
    'editor.findMatchHighlightBackground': '#6366f120',
    'editorBracketMatch.background': '#6366f120',
    'editorBracketMatch.border': '#6366f140',
    'editorGutter.background': '#0a0a0a',
    'editorWidget.background': '#18181b',
    'editorWidget.border': '#27272a',
    'input.background': '#18181b',
    'input.border': '#27272a',
    'focusBorder': '#6366f180',
    'list.activeSelectionBackground': '#6366f120',
    'list.hoverBackground': '#18181b80',
    'minimap.background': '#0a0a0a',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#27272a80',
    'scrollbarSlider.hoverBackground': '#3f3f4680',
    'scrollbarSlider.activeBackground': '#52525b80',
    'sideBar.background': '#0a0a0a',
    'sideBar.border': '#27272a40',
  }
};

// Register the theme once
let themeRegistered = false;
function ensureTheme() {
  if (typeof window === 'undefined') return;
  if (themeRegistered) return;
  try {
    loader.init().then(monaco => {
      monaco.editor.defineTheme('aurora-dark', AURORA_DARK_THEME);
      themeRegistered = true;
    });
  } catch {}
}

export default function MonacoEditor({ content, language, filePath, onContentChange, readOnly = false }) {
  const editorRef = useRef(null);
  const isDirty = useRef(false);

  useEffect(() => {
    ensureTheme();
  }, []);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;

    // Handle Ctrl+S
    editor.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [2048 | 49], // Ctrl+S
      run: () => {
        if (onContentChange && isDirty.current) {
          onContentChange(editor.getValue(), filePath);
          isDirty.current = false;
        }
      }
    });
  }, [onContentChange, filePath]);

  const handleChange = useCallback((value) => {
    isDirty.current = true;
    if (onContentChange) {
      onContentChange(value, filePath);
    }
  }, [onContentChange, filePath]);

  if (!content && content !== '') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <svg className="w-12 h-12 text-zinc-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p className="text-sm text-zinc-500">Select a file to edit</p>
        </div>
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      language={language || 'plaintext'}
      value={content}
      onChange={handleChange}
      onMount={handleMount}
      theme="aurora-dark"
      options={{
        readOnly,
        fontSize: 13,
        lineHeight: 1.7,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        smoothScrolling: true,
        padding: { top: 16, bottom: 16 },
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        formatOnPaste: true,
        tabSize: 2,
        insertSpaces: true,
        guides: { indentation: true, bracketPairs: true },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        renderLineHighlightOnlyWhenFocus: false,
        folding: true,
        foldingStrategy: 'indentation',
        showFoldingControls: 'mouseover',
        glyphMargin: false,
      }}
      loading={
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-2">
            <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-500">Loading editor...</span>
          </div>
        </div>
      }
    />
  );
}
