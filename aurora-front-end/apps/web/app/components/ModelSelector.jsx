// @aurora/web - ModelSelector Component
// Dropdown to select AI model, color-coded by provider

'use client';

import { cn } from '@/lib/utils';

/**
 * Model selector dropdown with provider color coding
 * 
 * @param {Object} props
 * @param {Array} props.models - Available models [{id, name, source}]
 * @param {string} props.selected - Currently selected model ID
 * @param {function} props.onChange - Selection handler
 * @param {boolean} props.disabled - Whether selector is disabled
 */
export default function ModelSelector({ models, selected, onChange, disabled }) {
  const currentModel = models.find(m => m.id === selected);
  const source = currentModel?.source;

  const colorClasses = {
    'OpenAI': 'bg-green-900/20 border-green-700/40 text-green-200',
    'Anthropic': 'bg-purple-900/20 border-purple-700/40 text-purple-200',
    'Ollama': 'bg-blue-900/20 border-blue-700/40 text-blue-200',
    'LM Studio': 'bg-orange-900/20 border-orange-700/40 text-orange-200'
  };

  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || models.length === 0}
      className={cn(
        'flex-1 px-3 py-1.5 rounded text-xs border transition-colors cursor-pointer max-w-full',
        'disabled:cursor-not-allowed disabled:opacity-50',
        source ? colorClasses[source] : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-300'
      )}
    >
      {models.length === 0 && <option value="">Loading models...</option>}
      {models.length === 0 && !disabled && <option value="">No models found</option>}
      {models.map(m => (
        <option key={m.id} value={m.id} className="bg-zinc-900 text-zinc-100">
          {m.name || m.id} {m.source ? `(${m.source})` : ''}
        </option>
      ))}
    </select>
  );
}
