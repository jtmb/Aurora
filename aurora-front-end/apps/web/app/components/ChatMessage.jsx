// @aurora/web - ChatMessage Component
// Renders individual chat messages (user/assistant) with model metadata

'use client';

import { cn } from '@/lib/utils';

/**
 * ChatMessage bubble component
 * 
 * Design spec:
 * - User messages: right-aligned, white bg, rounded-2xl rounded-tr-sm
 * - Assistant messages: left-aligned, dark bg, rounded-2xl rounded-tl-sm
 * - Shows model name and timestamp for assistant messages
 * 
 * @param {Object} props
 * @param {'user'|'assistant'} props.role - Message sender
 * @param {string} props.content - Message text content
 * @param {Date|string} props.timestamp - Message timestamp
 * @param {string} [props.model] - Model name (assistant only)
 * @param {string} [props.provider] - Provider name (assistant only)
 */
export default function ChatMessage({ role, content, timestamp, model, provider, thinking, searchSources, isSearchSuggestion, pendingQuery, showSearchTip }) {
  const isUser = role === 'user';
  const isError = role === 'error';

  return (
    <div className={cn(
      'flex gap-4 max-w-[90%]',
      isUser ? 'ml-auto justify-end' : ''
    )}>
      {/* Avatar for assistant / error */}
      {!isUser && (
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1',
          isError ? 'bg-red-600/80' : 'bg-indigo-600'
        )}>
          <span className="text-white font-bold text-xs">{isError ? '!' : 'A'}</span>
        </div>
      )}

      {/* Message bubble */}
      <div className={cn(
        'relative max-w-[85%] px-4 py-3 rounded-2xl',
        isError
          ? 'bg-red-950/40 text-red-300 border border-red-800/40 rounded-tl-sm'
          : isUser
            ? 'bg-zinc-100 text-zinc-900 rounded-tr-sm'
            : 'bg-zinc-800/60 text-zinc-100 border border-zinc-700/40 rounded-tl-sm'
      )}>
        {/* Error icon + message */}
        {isError && (
          <div className="flex items-start gap-2 mb-1">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          </div>
        )}
        {!isError && (
          <p className="text-base leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
        )}

        {/* Model metadata for assistant */}
        {!isUser && !isError && model && (
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-700/40">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              {model}
            </span>
            {provider && (
              <span className="text-[10px] text-zinc-600">{provider}</span>
            )}
          </div>
        )}

        {/* Timestamp */}
        <p className="text-[10px] text-zinc-500 mt-2">
          {new Date(timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}
