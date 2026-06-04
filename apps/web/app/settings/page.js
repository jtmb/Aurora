// @aurora/web/settings — Professional tabbed settings with Aurora sidebar

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('providers');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Load settings from localStorage
  const loadSettings = () => {
    try {
      return {
        openai: localStorage.getItem('OPENAI_API_KEY') || '',
        anthropic: localStorage.getItem('ANTHROPIC_API_KEY') || '',
        deepseek: localStorage.getItem('DEEPSEEK_API_KEY') || '',
        ollamaBase: localStorage.getItem('OLLAMA_API_BASE') || 'http://localhost:11434',
        lmStudioHost: localStorage.getItem('LM_STUDIO_HOST') || 'localhost',
        lmStudioPort: localStorage.getItem('LM_STUDIO_PORT') || '1234',
        lmStudioUrl: localStorage.getItem('LM_STUDIO_URL') || '',
        lmStudioMaxModels: localStorage.getItem('LM_STUDIO_MAX_MODELS') || '3',
      };
    } catch {
      return {
        openai: '', anthropic: '', deepseek: '', ollamaBase: 'http://localhost:11434',
        lmStudioHost: 'localhost', lmStudioPort: '1234', lmStudioUrl: '', lmStudioMaxModels: '3',
      };
    }
  };

  const [settings, setSettings] = useState(loadSettings);
  const [showApiKey, setShowApiKey] = useState({ openai: false, anthropic: false, deepseek: false });
  const [isLoading, setIsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [user, setUser] = useState(null);

  // Check auth on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({ id: payload.userId, email: payload.email });
        // Only restore from Redis if localStorage is empty (first visit)
        if (!localStorage.getItem('LM_STUDIO_URL') && !localStorage.getItem('OPENAI_API_KEY') && !localStorage.getItem('ANTHROPIC_API_KEY') && !localStorage.getItem('DEEPSEEK_API_KEY') && !localStorage.getItem('OLLAMA_API_BASE')) {
          loadKeysFromServer();
        }
      } catch {}
    }
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
    setUserMenuOpen(false);
    router.push('/');
  };

  // Save provider keys to Redis via /api/auth/keys (persists across cache clears)
  const syncKeysToServer = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const providers = [
      { id: 'OPENAI', key: settings.openai, name: 'OpenAI API Key' },
      { id: 'ANTHROPIC', key: settings.anthropic, name: 'Anthropic API Key' },
      { id: 'DEEPSEEK', key: settings.deepseek, name: 'DeepSeek API Key' },
      { id: 'OLLAMA', key: settings.ollamaBase, name: 'Ollama Base URL' },
      { id: 'LM_STUDIO', key: `http://${settings.lmStudioHost || 'localhost'}:${settings.lmStudioPort || '1234'}/v1`, name: 'LM Studio URL' },
    ];
    for (const p of providers) {
      if (!p.key) continue;
      try {
        await fetch('/api/auth/keys', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: p.id, name: p.name, key: p.key })
        });
      } catch { /* Server sync is best-effort; localStorage is canonical */ }
    }
  };

  // Load provider keys from Redis and hydrate localStorage
  const loadKeysFromServer = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    try {
      const res = await fetch('/api/auth/keys', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const keys = data.keys || [];
      for (const k of keys) {
        if (k.rawKey) {
          const storageKey = k.provider === 'OLLAMA' ? 'OLLAMA_API_BASE'
            : k.provider === 'LM_STUDIO' ? 'LM_STUDIO_URL'
            : k.provider === 'DEEPSEEK' ? 'DEEPSEEK_API_KEY'
            : `${k.provider.toUpperCase()}_API_KEY`;
          // Only fill missing keys — localStorage is the source of truth
          if (!localStorage.getItem(storageKey)) {
            localStorage.setItem(storageKey, k.rawKey);
          }
        }
      }
    } catch { /* Server unavailable — rely on localStorage */ }
  };

  const handleSaveSettings = async (e) => {
    e?.preventDefault();
    setIsLoading(true);
    try {
      if (settings.openai) localStorage.setItem('OPENAI_API_KEY', settings.openai);
      if (settings.anthropic) localStorage.setItem('ANTHROPIC_API_KEY', settings.anthropic);
      if (settings.deepseek) localStorage.setItem('DEEPSEEK_API_KEY', settings.deepseek);
      localStorage.setItem('OLLAMA_API_BASE', settings.ollamaBase);
      localStorage.setItem('LM_STUDIO_HOST', settings.lmStudioHost || 'localhost');
      localStorage.setItem('LM_STUDIO_PORT', settings.lmStudioPort || '1234');
      localStorage.setItem('LM_STUDIO_URL', `http://${settings.lmStudioHost || 'localhost'}:${settings.lmStudioPort || '1234'}/v1`);
      localStorage.setItem('LM_STUDIO_MAX_MODELS', settings.lmStudioMaxModels || '3');
      // Sync to server so keys survive cache clears
      await syncKeysToServer();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const tabs = [
    { id: 'providers', label: 'Providers', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { id: 'account', label: 'Account', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
    { id: 'about', label: 'About', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' }
  ];

  return (
    <div className="flex h-screen bg-zinc-950 text-white">
      {/* LEFT SIDEBAR — matches main page sidebar */}
      <aside className="w-[260px] flex-shrink-0 flex flex-col border-r border-zinc-800/40 bg-zinc-900 hidden md:flex">
        {/* Aurora Logo — static brand */}
        <div className="px-3 pt-3 pb-2 border-b border-zinc-800/40">
          <div className="w-full flex items-center gap-3 px-3 py-2.5">
            <svg className="w-10 h-10 flex-shrink-0" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="aurora-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#c084fc" />
                </linearGradient>
                <linearGradient id="aurora-stroke-2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#e879f9" />
                </linearGradient>
                <linearGradient id="aurora-stroke-3" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#c4b5fd" />
                  <stop offset="100%" stopColor="#f0abfc" />
                </linearGradient>
              </defs>
              <path d="M3 17c1.5-2 4-4 6-5s4-1 6 1 4 3 6 2" stroke="url(#aurora-stroke)" strokeWidth="1.5" opacity="0.9" />
              <path d="M3 13c2-3 5-5 8-4s5 3 8 0" stroke="url(#aurora-stroke-2)" strokeWidth="1.5" opacity="0.7" />
              <path d="M3 9c2.5-3 6-4 9-2s5 4 8 1" stroke="url(#aurora-stroke-3)" strokeWidth="1.5" opacity="0.5" />
            </svg>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-white tracking-tight">Aurora</p>
              <p className="text-[10px] text-zinc-500 truncate">Multi-model Gateway</p>
            </div>
          </div>
        </div>

        {/* Nav tabs */}
        <div className="flex-1 overflow-y-auto py-3">
          <a href="/" className="w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
            <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" /></svg>
            Back to Chat
          </a>

          <div className="my-2 border-t border-zinc-800/40" />

          <nav className="space-y-[calc(0.75rem+3px)]">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-left transition-colors ${
                  activeTab === tab.id ? 'bg-indigo-600/15 text-white' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20'
                }`}
              >
                <svg className="w-[1.2rem] h-[1.2rem] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={1.5} d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* User info */}
        <div className="p-4 border-t border-zinc-800/40">
          {!user ? (
            <a
              href="/"
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition-colors flex items-center justify-center"
            >
              Sign In
            </a>
          ) : (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-medium">
                  {user?.email?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">{user?.email || 'Guest'}</p>
                  <p className="text-xs text-zinc-500">Free Plan</p>
                </div>
                <svg className={`w-4 h-4 text-zinc-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>

              {/* Drop-up Menu */}
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-850 border border-zinc-700/50 rounded-xl shadow-2xl z-20 py-1.5 overflow-hidden">
                    <a href="/" className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors" onClick={() => setUserMenuOpen(false)}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                      Chat
                    </a>
                    <a href="/docs" className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors" onClick={() => setUserMenuOpen(false)}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                      Documentation
                    </a>
                    <div className="border-t border-zinc-700/30 my-1.5" />
                    <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-950/20 hover:text-red-300 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950">
        <div className="flex-1 overflow-auto p-6 pt-[50px]">
          {/* Tab Bar */}
          <div className="border-b border-zinc-800/40 mb-6">
            <nav className="flex gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-indigo-600 text-white'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* ===== PROVIDERS TAB ===== */}
          {activeTab === 'providers' && (
            <div className="space-y-5 max-w-2xl">
              {/* OpenAI */}
              <ProviderCard
                color="indigo" initials="OA" title="OpenAI" subtitle="Primary provider for chat completions"
                actionLabel="Dashboard" actionUrl="https://platform.openai.com/api-keys"
              >
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">API Key</label>
                    <div className="flex gap-2">
                      <input type={showApiKey.openai ? 'text' : 'password'} value={settings.openai}
                        onChange={(e) => setSettings({ ...settings, openai: e.target.value })}
                        placeholder="sk-" className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50" />
                      <button onClick={() => setShowApiKey(prev => ({ ...prev, openai: !prev.openai }))}
                        className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:bg-zinc-700 transition-colors">
                        {showApiKey.openai ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                </div>
              </ProviderCard>

              {/* Anthropic */}
              <ProviderCard
                color="purple" initials="An" title="Anthropic" subtitle="Claude 3 model family"
                actionLabel="Console" actionUrl="https://console.anthropic.com/"
              >
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">API Key</label>
                    <div className="flex gap-2">
                      <input type={showApiKey.anthropic ? 'text' : 'password'} value={settings.anthropic}
                        onChange={(e) => setSettings({ ...settings, anthropic: e.target.value })}
                        placeholder="sk-ant-" className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50" />
                      <button onClick={() => setShowApiKey(prev => ({ ...prev, anthropic: !prev.anthropic }))}
                        className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:bg-zinc-700 transition-colors">
                        {showApiKey.anthropic ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">Models: Claude 3 Opus, Sonnet, Haiku</p>
                </div>
              </ProviderCard>

              {/* DeepSeek */}
              <ProviderCard
                color="teal" initials="DS" title="DeepSeek" subtitle="OpenAI-compatible — deepseek-chat, deepseek-reasoner"
                actionLabel="Dashboard" actionUrl="https://platform.deepseek.com/api_keys"
              >
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">API Key</label>
                    <div className="flex gap-2">
                      <input type={showApiKey.deepseek ? 'text' : 'password'} value={settings.deepseek}
                        onChange={(e) => setSettings({ ...settings, deepseek: e.target.value })}
                        placeholder="sk-" className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-teal-600/50" />
                      <button onClick={() => setShowApiKey(prev => ({ ...prev, deepseek: !prev.deepseek }))}
                        className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:bg-zinc-700 transition-colors">
                        {showApiKey.deepseek ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">Models: deepseek-chat, deepseek-reasoner</p>
                </div>
              </ProviderCard>

              {/* Ollama */}
              <ProviderCard
                color="green" initials="Ol" title="Ollama" subtitle="Local LLM models — no API key required"
              >
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">Base URL</label>
                    <input type="text" value={settings.ollamaBase}
                      onChange={(e) => setSettings({ ...settings, ollamaBase: e.target.value })}
                      placeholder="http://localhost:11434" className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50" />
                  </div>
                  <p className="text-xs text-zinc-500">
                    Run with: <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-xs text-zinc-300">ollama pull llama3</code>
                  </p>
                </div>
              </ProviderCard>

              {/* LM Studio */}
              <ProviderCard
                color="orange" initials="LS" title="LM Studio" subtitle="Local LLM server with GUI"
                actionLabel="Download" actionUrl="https://lmstudio.ai"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">Host</label>
                    <input type="text" value={settings.lmStudioHost}
                      onChange={(e) => setSettings({ ...settings, lmStudioHost: e.target.value })}
                      placeholder="localhost" className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1.5">Port</label>
                    <input type="text" value={settings.lmStudioPort}
                      onChange={(e) => setSettings({ ...settings, lmStudioPort: e.target.value })}
                      placeholder="1234" className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-zinc-400 mb-1.5">Max Active Models</label>
                  <input type="number" min="1" max="20" value={settings.lmStudioMaxModels}
                    onChange={(e) => setSettings({ ...settings, lmStudioMaxModels: e.target.value })}
                    placeholder="3" className="w-24 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50" />
                  <p className="text-[11px] text-zinc-500 mt-1">Limits how many models LM Studio can have active at once</p>
                </div>
              </ProviderCard>

              {/* Save */}
              <button onClick={handleSaveSettings} disabled={isLoading}
                className={`w-full rounded-lg px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                  saved ? 'bg-green-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-500'
                } disabled:opacity-50 disabled:cursor-not-allowed`}>
                {isLoading ? (
                  <><svg className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" /> Saving...</>
                ) : saved ? (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Saved!</>
                ) : (
                  'Save Provider Settings'
                )}
              </button>
            </div>
          )}

          {/* ===== ACCOUNT TAB ===== */}
          {activeTab === 'account' && (
            <div className="max-w-2xl space-y-5">
              <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
                <h3 className="text-base font-medium text-white mb-4">Account Details</h3>
                {user ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Email</label>
                      <p className="text-sm text-white bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5">{user.email}</p>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">User ID</label>
                      <p className="text-sm text-zinc-500 font-mono bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5">{user.id}</p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-zinc-500 text-sm mb-3">Sign in to view account details</p>
                    <a href="/" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition-colors">
                      Sign In
                    </a>
                  </div>
                )}
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
                <h3 className="text-base font-medium text-white mb-2">Session</h3>
                <p className="text-sm text-zinc-500 mb-4">Manage your active session.</p>
                <button onClick={handleSignOut}
                  className="px-4 py-2 bg-red-600/20 border border-red-700/30 text-red-400 rounded-lg text-sm hover:bg-red-600/30 transition-colors">
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* ===== ABOUT TAB ===== */}
          {activeTab === 'about' && (
            <div className="max-w-2xl space-y-5">
              <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center">
                    <span className="text-white font-bold text-xl">A</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Aurora Gateway</h3>
                    <p className="text-sm text-zinc-500">Multi-model LLM API Gateway</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm text-zinc-400">
                  <p className="flex justify-between py-2 border-b border-zinc-800/30">
                    <span className="text-zinc-500">Version</span>
                    <span className="text-zinc-300 font-mono">1.0.0</span>
                  </p>
                  <p className="flex justify-between py-2 border-b border-zinc-800/30">
                    <span className="text-zinc-500">Framework</span>
                    <span className="text-zinc-300">Next.js 15</span>
                  </p>
                  <p className="flex justify-between py-2 border-b border-zinc-800/30">
                    <span className="text-zinc-500">Architecture</span>
                    <span className="text-zinc-300">Turborepo Monorepo</span>
                  </p>
                  <p className="flex justify-between py-2">
                    <span className="text-zinc-500">Providers</span>
                    <span className="text-zinc-300">OpenAI, Anthropic, Ollama, LM Studio</span>
                  </p>
                </div>
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
                <h3 className="text-base font-medium text-white mb-2">OpenAI-Compatible API</h3>
                <p className="text-sm text-zinc-500 mb-3">
                  Aurora exposes <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-xs text-zinc-300">/api/v1/chat/completions</code> — a drop-in replacement for any OpenAI client.
                </p>
                <pre className="bg-zinc-800 border border-zinc-700/40 rounded-lg p-4 text-xs text-zinc-300 overflow-x-auto">
{`curl http://localhost:3000/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'`}
                </pre>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Reusable provider card component
function ProviderCard({ color, initials, title, subtitle, actionLabel, actionUrl, children }) {
  const colorMap = {
    indigo: { bg: 'bg-indigo-600/20', text: 'text-indigo-400' },
    purple: { bg: 'bg-purple-600/20', text: 'text-purple-400' },
    green: { bg: 'bg-green-600/20', text: 'text-green-400' },
    orange: { bg: 'bg-orange-600/20', text: 'text-orange-400' }
  };
  const c = colorMap[color] || colorMap.indigo;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>
          <span className={`${c.text} font-bold text-xs`}>{initials}</span>
        </div>
        <div>
          <h3 className="text-base font-medium text-white">{title}</h3>
          <p className="text-sm text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="ml-[52px]">
        {children}
        {actionLabel && actionUrl && (
          <p className="text-xs text-zinc-600 mt-3">
            <a href={actionUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              {actionLabel} &rarr;
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
