// @aurora/web - FileTabs component for open file tabs bar

'use client';

export default function FileTabs({ openFiles, activeFile, onTabClick, onTabClose }) {
  if (openFiles.length === 0) {
    return (
      <div className="h-9 flex items-center px-3 bg-zinc-900/80 border-b border-zinc-800/40">
        <span className="text-xs text-zinc-600">No files open</span>
      </div>
    );
  }

  return (
    <div className="h-9 flex items-center bg-zinc-900/80 border-b border-zinc-800/40 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {openFiles.map((file) => {
        const isActive = activeFile === file.path;
        const fileName = file.name || file.path.split('/').pop();
        
        return (
          <div
            key={file.path}
            onClick={() => onTabClick(file.path)}
            className={`group flex items-center gap-1.5 h-full px-3 text-xs cursor-pointer border-r border-zinc-800/40 transition-colors flex-shrink-0 max-w-[180px] ${
              isActive
                ? 'bg-zinc-950 text-zinc-200 border-t-2 border-t-indigo-500'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 border-t-2 border-t-transparent'
            }`}
          >
            {/* File icon by extension */}
            <span className="w-3 h-3 flex-shrink-0 flex items-center justify-center">
              {file.language === 'javascript' || file.language === 'typescript' ? (
                <span className="text-amber-400 text-[8px] font-bold">JS</span>
              ) : file.language === 'css' || file.language === 'scss' ? (
                <span className="text-sky-400 text-[8px] font-bold">#</span>
              ) : file.language === 'python' ? (
                <span className="text-blue-400 text-[8px] font-bold">Py</span>
              ) : file.language === 'markdown' ? (
                <span className="text-blue-300 text-[8px] font-bold">MD</span>
              ) : file.language === 'json' ? (
                <span className="text-yellow-400 text-[8px] font-bold">{'{}'}</span>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              )}
            </span>
            <span className="truncate">{fileName}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(file.path);
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-700/50 transition-all flex-shrink-0"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
