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
export default function ChatMessage({ role, content, timestamp, model, provider }) {
  const isUser = role === 'user';

  return (
    <div className={cn(
      'flex gap-4 max-w-[90%]',
      isUser ? 'ml-auto justify-end' : ''
    )}>
      {/* Avatar for assistant */}
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-1">
          <span className="text-white font-bold text-xs">A</span>
        </div>
      )}

      {/* Message bubble */}
      <div className={cn(
        'relative max-w-[85%] px-4 py-3 rounded-2xl',
        isUser
          ? 'bg-zinc-100 text-zinc-900 rounded-tr-sm'
          : 'bg-zinc-800/60 text-zinc-100 border border-zinc-700/40 rounded-tl-sm'
      )}>
        <p className="text-base leading-relaxed whitespace-pre-wrap">
          {content}
        </p>

        {/* Model metadata for assistant */}
        {!isUser && model && (
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
