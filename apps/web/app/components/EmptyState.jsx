// @aurora/web - EmptyState Component
// Shown when no messages exist in the chat

'use client';

/**
 * Empty state with suggested prompts when no chat messages exist
 * 
 * @param {Object} props
 * @param {function} props.onPromptClick - Called when user clicks a suggested prompt
 * @param {boolean} props.hasModels - Whether models are available
 */
export default function EmptyState({ onPromptClick, hasModels }) {
  const suggestions = [
    { label: 'Brainstorm projects', prompt: 'Help me brainstorm project ideas' },
    { label: 'Explain a concept', prompt: 'Explain quantum computing simply' },
    { label: 'Creative writing', prompt: 'Write a poem about the sea' },
    { label: 'Code review', prompt: 'Review this code for best practices' }
  ];

  return (
    <div className="text-center max-w-lg mx-auto py-12">
      {/* Aurora logo */}
      <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-600/30 flex items-center justify-center mx-auto mb-6">
        <span className="text-indigo-400 font-bold text-2xl">A</span>
      </div>

      <h1 className="text-2xl font-semibold text-white mb-3">
        What can I help with?
      </h1>
      
      <p className="text-zinc-500 text-sm mb-8">
        {hasModels
          ? 'Ask me anything — I\'m powered by multiple AI models through Aurora Gateway.'
          : 'Configure a provider in Settings or run Ollama locally to get started.'}
      </p>
      
      {/* Suggestion pills */}
      <div className="flex flex-wrap justify-center gap-3">
        {suggestions.map(({ label, prompt }) => (
          <button
            key={label}
            onClick={() => onPromptClick(prompt)}
            className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all duration-200"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
