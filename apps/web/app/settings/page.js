// @aurora/web/settings - Settings page with proper storage and model fetching
// Supports custom LM Studio endpoint configuration

'use client';

import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('providers');
  
  // Load settings from localStorage on mount - supports custom LM Studio endpoints
  const loadSettings = () => {
    try {
      return {
        openai: localStorage.getItem('OPENAI_API_KEY') || '',
        anthropic: localStorage.getItem('ANTHROPIC_API_KEY') || '',
        ollamaBase: localStorage.getItem('OLLAMA_API_BASE') || 'http://localhost:11434',
        lmStudioHost: localStorage.getItem('LM_STUDIO_HOST') || 'localhost',
        lmStudioPort: localStorage.getItem('LM_STUDIO_PORT') || '1234',
        lmStudioUrl: localStorage.getItem('LM_STUDIO_URL') || '',
        defaultProvider: localStorage.getItem('DEFAULT_PROVIDER') || 'openai'
      };
    } catch {
      return {
        openai: '',
        anthropic: '',
        ollamaBase: 'http://localhost:11434',
        lmStudioHost: 'localhost',
        lmStudioPort: '1234',
        lmStudioUrl: '',
        defaultProvider: 'openai'
      };
    }
  };

  const [settings, setSettings] = useState(loadSettings);
  const [showApiKey, setShowApiKey] = useState({ openai: false, anthropic: false });
  const [isLoading, setIsLoading] = useState(false);
  
  // Fetch available models on mount - only if API keys are configured
  const [models, setModels] = useState([]);
  const [isFetching, setIsFetching] = useState(true);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    // Only fetch models if at least one API key is configured
    try {
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      
      if (!openaiKey && !anthropicKey) {
        console.log('No API keys configured, skipping model fetch');
        setIsFetching(false);
        return;
      }

      setIsFetching(true);
      const token = localStorage.getItem('auth_token') || '';
      
      // Don't send auth header to models API - it should work without authentication for discovery
      const res = await fetch('/api/providers/models', {
        headers: {}
      });
      
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
        
        // Only hide loading state if we got models
        if (data.models && data.models.length > 0) {
          setIsFetching(false);
        }
      } else {
        console.warn(`Models API returned ${res.status} - no models available`);
        setIsFetching(false);
      }
    } catch (error) {
      // Silently handle errors - just show empty models
      console.debug('Fetch models error:', error.message);
      setModels([]);
      setIsFetching(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e?.preventDefault();
    
    try {
      setIsLoading(true);
      
      // Save to localStorage immediately for immediate use
      if (settings.openai) localStorage.setItem('OPENAI_API_KEY', settings.openai);
      if (settings.anthropic) localStorage.setItem('ANTHROPIC_API_KEY', settings.anthropic);
      localStorage.setItem('OLLAMA_API_BASE', settings.ollamaBase);
      
      // Save LM Studio as separate host and port (for backward compatibility)
      localStorage.setItem('LM_STUDIO_HOST', settings.lmStudioHost || 'localhost');
      localStorage.setItem('LM_STUDIO_PORT', settings.lmStudioPort || '1234');
      localStorage.setItem('DEFAULT_PROVIDER', settings.defaultProvider);
      
      // NEW: Save full custom LM Studio URL (e.g., http://192.168.0.13:1234)
      const lmStudioUrl = `http://${settings.lmStudioHost || 'localhost'}:${settings.lmStudioPort || '1234'}`;
      localStorage.setItem('LM_STUDIO_URL', lmStudioUrl);
      
      // Save auth token if set (placeholder for now)
      localStorage.setItem('auth_token', '');
      
      console.log('Settings saved. Models will load from:', lmStudioUrl);
      
      // Reload page to apply settings
      window.location.href = '/';
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save settings');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-white">
      {/* LEFT SIDEBAR */}
      <aside className="w-[260px] flex-shrink-0 flex flex-col border-r border-zinc-800/40 bg-zinc-900 hidden md:flex">
        <div className="flex-1 overflow-y-auto py-3">
          {/* Back button */}
          <button onClick={() => window.history.back()} className="w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
            <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={1.5} d="M15 19l-7-7m0 0l7-7m-7 7v13" />
            </svg>
            Back
          </button>

          {/* Settings content */}
          <nav className="space-y-[calc(0.75rem+3px)]">
            <a href="/" className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
              <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={1.5} d="M8.69 8.05C8.32 7.68 8.05 7.68 7.68 8.05L4.5 11.23C2.66 13.07 2.66 15.93 4.5 17.77L7.68 20.95C8.05 21.32 8.32 21.32 8.69 20.95C9.06 20.58 9.06 20.31 8.69 19.94L5.51 16.76C5.14 16.39 5.14 16.12 5.51 15.75C5.88 15.38 6.15 15.38 6.52 15.75L9.69 18.93C10.06 19.3 10.33 19.3 10.7 18.93C11.07 18.56 11.07 18.29 10.7 17.92L7.52 14.74C7.15 14.37 7.15 14.1 7.52 13.73L10.69 10.55C11.06 10.18 11.06 9.91 10.69 9.54L7.52 6.36C7.15 5.99 7.15 5.72 7.52 5.35C7.89 4.98 8.16 4.98 8.53 5.35L11.7 8.53C12.07 8.9 12.07 9.17 11.7 9.54L8.53 12.72C8.16 13.09 8.16 13.36 8.53 13.73L11.7 16.91C12.07 17.28 12.07 17.55 11.7 17.92L8.53 21.1C8.16 21.47 7.89 21.47 7.52 21.1C7.15 20.73 7.15 20.46 7.52 20.09L10.69 16.91C11.06 16.54 11.06 16.27 10.69 15.9L7.52 12.72L4.35 9.54C3.98 9.17 3.98 8.9 4.35 8.53L7.52 5.35C7.89 4.98 8.16 4.98 8.53 5.35L11.7 8.53" />
              </svg>
              Settings
            </a>

            <a href="/" className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
              <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.896 4.547 9.504 4.547 8.25 3.25S3.25 4.547 3.25 5.75v13c0 1.196.553 1.749 1.749 1.749H18a2 2 0 002-2V5.75C20 4.547 19.447 4 18.25 3.25A2.002 2.002 0 0016.25 2H9M12 6.253v13m0-13C13.104 4.547 14.496 4.547 15.75 3.25S20.75 4.547 20.75 5.75v13c0 1.196-.553 1.749-1.749 1.749H8a2 2 0 00-2 2V5.75C6 4.547 6.553 4 7.75 3.25A2.002 2.002 0 009.75 2H15" />
              </svg>
              Library
            </a>

            <a href="/" className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
              <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Account
            </a>
          </nav>
        </div>

        {/* User info at bottom */}
        <div className="p-4 border-t border-zinc-800/40">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-zinc-800/50">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-medium">
              U
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">User</p>
              <p className="text-xs text-zinc-500">Free Plan</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        <div className="flex-1 overflow-auto p-6 pt-[50px]">
          <h1 className="text-2xl font-semibold text-white mb-6">Settings</h1>

          {/* Provider Tabs */}
          <div className="border-b border-zinc-800/40 mb-6">
            <nav className="flex gap-2">
              <button
                onClick={() => setActiveTab('providers')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'providers'
                    ? 'border-indigo-600 text-white bg-zinc-800/50'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Provider Settings
              </button>
            </nav>
          </div>

          {/* Provider Cards */}
          <div className="space-y-6">
            {/* OpenAI Provider Card */}
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                  <span className="text-indigo-600 font-bold text-xs">OA</span>
                </div>
                <div>
                  <h3 className="text-base font-medium text-white">OpenAI</h3>
                  <p className="text-sm text-zinc-500">Primary provider for chat completions</p>
                </div>
              </div>

              <div className="space-y-4 ml-13">
                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">API Key</label>
                  <div className="flex gap-3">
                    <input
                      type="password"
                      value={settings.openai}
                      onChange={(e) => setSettings({ ...settings, openai: e.target.value })}
                      placeholder="sk-"
                      className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                    />
                    <button
                      onClick={() => setShowApiKey(prev => ({ ...prev, openai: !prev.openai }))}
                      className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:bg-zinc-700 transition-colors"
                    >
                      {showApiKey.openai ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Default Model</label>
                  <select
                    value={settings.defaultProvider === 'openai' ? 'gpt-3.5-turbo' : settings.defaultProvider === 'openai' ? 'gpt-4' : 'gpt-4o'}
                    onChange={(e) => {}}
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none"
                  >
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    <option value="gpt-4">GPT-4</option>
                    <option value="gpt-4o">GPT-4o</option>
                  </select>
                </div>

                <p className="text-xs text-zinc-600">
                  Visit{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-400">
                    OpenAI Dashboard
                  </a>{' '}
                  to generate API keys.
                </p>
              </div>
            </div>

            {/* Anthropic Provider Card */}
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-purple-600/20 flex items-center justify-center">
                  <span className="text-purple-600 font-bold text-xs">An</span>
                </div>
                <div>
                  <h3 className="text-base font-medium text-white">Anthropic</h3>
                  <p className="text-sm text-zinc-500">Claude 3 model family</p>
                </div>
              </div>

              <div className="space-y-4 ml-13">
                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">API Key</label>
                  <div className="flex gap-3">
                    <input
                      type="password"
                      value={settings.anthropic}
                      onChange={(e) => setSettings({ ...settings, anthropic: e.target.value })}
                      placeholder="sk-"
                      className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                    />
                    <button
                      onClick={() => setShowApiKey(prev => ({ ...prev, anthropic: !prev.anthropic }))}
                      className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:bg-zinc-700 transition-colors"
                    >
                      {showApiKey.anthropic ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Base URL (optional)</label>
                  <input
                    type="text"
                    value={process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1'}
                    readOnly
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                  />
                </div>

                <p className="text-xs text-zinc-600">
                  Supported models: Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku
                </p>
              </div>
            </div>

            {/* Ollama Provider Card */}
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center">
                  <span className="text-green-600 font-bold text-xs">Ol</span>
                </div>
                <div>
                  <h3 className="text-base font-medium text-white">Ollama</h3>
                  <p className="text-sm text-zinc-500">Local LLM models (no API key required)</p>
                </div>
              </div>

              <div className="space-y-4 ml-13">
                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Base URL</label>
                  <input
                    type="text"
                    value={settings.ollamaBase}
                    onChange={(e) => setSettings({ ...settings, ollamaBase: e.target.value })}
                    placeholder="http://localhost:11434"
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Available Models</label>
                  <select
                    disabled={isFetching || models.length === 0}
                    value=""
                    className={`w-full rounded-lg px-3 py-2.5 text-sm border focus:outline-none transition-colors ${
                      isFetching 
                        ? 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400' 
                        : models.length === 0
                          ? 'bg-zinc-800/60 border-zinc-700/40 text-zinc-500'
                          : 'bg-green-900/20 border-green-700/40 text-green-200'
                    }`}
                  >
                    {isFetching ? (
                      <option value="">Loading...</option>
                    ) : models.length === 0 ? (
                      <option value="">No Ollama configured</option>
                    ) : (
                      models.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.id}
                        </option>
                      ))
                    )}
                  </select>
                  <p className="text-xs text-zinc-600">
                    Run Ollama with: <code className="bg-zinc-800 px-1 rounded">ollama pull llama3</code>
                  </p>
                </div>
              </div>
            </div>

            {/* LM Studio Provider Card */}
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-orange-600/20 flex items-center justify-center">
                  <span className="text-orange-600 font-bold text-xs">LS</span>
                </div>
                <div>
                  <h3 className="text-base font-medium text-white">LM Studio</h3>
                  <p className="text-sm text-zinc-500">Local LLM server with GUI</p>
                </div>
              </div>

              <div className="space-y-4 ml-13">
                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Host</label>
                  <input
                    type="text"
                    value={settings.lmStudioHost}
                    onChange={(e) => setSettings({ ...settings, lmStudioHost: e.target.value })}
                    placeholder="localhost"
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Port</label>
                  <input
                    type="text"
                    value={settings.lmStudioPort}
                    onChange={(e) => setSettings({ ...settings, lmStudioPort: e.target.value })}
                    placeholder="1234"
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                  />
                </div>

                <p className="text-xs text-zinc-600">
                  Download LM Studio from{' '}
                  <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-400">
                    lmstudio.ai
                  </a>
                </p>
              </div>
            </div>

            {/* Default Provider */}
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
              <h3 className="text-base font-medium text-white mb-4">Default Provider</h3>
              <div className="space-y-2 ml-4">
                <label className="block text-sm text-zinc-400">Select default provider for new chats:</label>
                <select
                  value={settings.defaultProvider}
                  onChange={(e) => setSettings({ ...settings, defaultProvider: e.target.value })}
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="ollama">Ollama</option>
                  <option value="lmstudio">LM Studio</option>
                </select>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveSettings}
              disabled={isLoading}
              className="w-full bg-indigo-600 text-white rounded-lg px-4 py-3 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></svg>
                  Saving...
                </>
              ) : (
                'Save Provider Settings'
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}