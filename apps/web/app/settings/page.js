// @aurora/web/settings — Professional tabbed settings with Aurora sidebar

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const DEFAULT_SETTINGS = {
  openai: '',
  anthropic: '',
  deepseek: '',
  ollamaBase: 'http://localhost:11434',
  lmStudioHost: 'localhost',
  lmStudioPort: '1234',
  lmStudioUrl: '',
  lmStudioMaxModels: '3',
  lmStudioApiKey: '',
  lmStudioApiKeyEnabled: false,
  providerEnabled: { openai: false, anthropic: false, deepseek: false, ollama: true, lmstudio: false },
  removedProviders: [],
};

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('providers');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // ---- State (must be before any function that references these) ----
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ollamaBase: 'http://localhost:11434' });
  const [providerEnabled, setProviderEnabled] = useState({ openai: false, anthropic: false, deepseek: false, ollama: true, lmstudio: false });
  const [showApiKey, setShowApiKey] = useState({ openai: false, anthropic: false, deepseek: false });
  const [lmStudioApiKeyEnabled, setLmStudioApiKeyEnabled] = useState(false);
  const [testStatus, setTestStatus] = useState({});
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [removedProviders, setRemovedProviders] = useState(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [user, setUser] = useState(null);

  // Password reset state
  const [passwordCurrent, setPasswordCurrent] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // ---- Utility functions (can reference state vars above) ----

  // Load settings from server DB, fall back to localStorage
  const loadSettingsFromDb = useCallback(async (token) => {
    try {
      const res = await fetch('/api/auth/provider-settings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.settings) return data.settings;
    } catch {}
    return null;
  }, []);

  // Save settings to server DB
  const saveSettingsToDb = useCallback(async (token, settingsData) => {
    try {
      await fetch('/api/auth/provider-settings', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settings: settingsData }),
      });
    } catch {}
  }, []);

  // Build a settings snapshot from current state
  const buildSettingsSnapshot = useCallback(() => {
    return {
      ...settings,
      lmStudioApiKeyEnabled,
      providerEnabled,
      removedProviders: [...removedProviders],
    };
  }, [settings, lmStudioApiKeyEnabled, providerEnabled, removedProviders]);

  // Load settings from localStorage (fallback cache)
  const loadProviderEnabledFromCache = () => {
    try {
      const stored = localStorage.getItem('PROVIDER_ENABLED');
      if (stored) return JSON.parse(stored);
    } catch {}
    return { openai: false, anthropic: false, deepseek: false, ollama: true, lmstudio: false };
  };

  const loadRemovedFromCache = () => {
    try {
      const stored = localStorage.getItem('PROVIDER_REMOVED');
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  };

  const loadSettingsFromCache = () => {
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
        lmStudioApiKey: localStorage.getItem('LM_STUDIO_API_KEY') || '',
        lmStudioApiKeyEnabled: localStorage.getItem('LM_STUDIO_API_KEY_ENABLED') === 'true',
        providerEnabled: loadProviderEnabledFromCache(),
        removedProviders: loadRemovedFromCache(),
      };
    } catch {
      return { ...DEFAULT_SETTINGS, providerEnabled: { ...DEFAULT_SETTINGS.providerEnabled }, removedProviders: [], lmStudioApiKeyEnabled: false };
    }
  };

  // Write settings to localStorage (sync cache)
  const writeSettingsToCache = (s) => {
    try {
      if (s.openai) localStorage.setItem('OPENAI_API_KEY', s.openai); else localStorage.removeItem('OPENAI_API_KEY');
      if (s.anthropic) localStorage.setItem('ANTHROPIC_API_KEY', s.anthropic); else localStorage.removeItem('ANTHROPIC_API_KEY');
      if (s.deepseek) localStorage.setItem('DEEPSEEK_API_KEY', s.deepseek); else localStorage.removeItem('DEEPSEEK_API_KEY');
      if (s.ollamaBase) localStorage.setItem('OLLAMA_API_BASE', s.ollamaBase);
      localStorage.setItem('LM_STUDIO_HOST', s.lmStudioHost || 'localhost');
      localStorage.setItem('LM_STUDIO_PORT', s.lmStudioPort || '1234');
      if (s.lmStudioUrl) localStorage.setItem('LM_STUDIO_URL', s.lmStudioUrl); else localStorage.removeItem('LM_STUDIO_URL');
      localStorage.setItem('LM_STUDIO_MAX_MODELS', s.lmStudioMaxModels || '3');
      if (s.lmStudioApiKey) localStorage.setItem('LM_STUDIO_API_KEY', s.lmStudioApiKey); else localStorage.removeItem('LM_STUDIO_API_KEY');
      localStorage.setItem('LM_STUDIO_API_KEY_ENABLED', String(s.lmStudioApiKeyEnabled ?? false));
      localStorage.setItem('PROVIDER_ENABLED', JSON.stringify(s.providerEnabled || {}));
      localStorage.setItem('PROVIDER_REMOVED', JSON.stringify(s.removedProviders || []));
    } catch {}
  };

  // Billing state
  const [billingPeriod, setBillingPeriod] = useState('30d');
  const [usageData, setUsageData] = useState(null);
  const [dailyUsage, setDailyUsage] = useState(null);
  const [pricingData, setPricingData] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [balanceData, setBalanceData] = useState(null);

  const getDefaultRemoved = (loadedSettings) => {
    const unconfigured = new Set();
    if (!loadedSettings.openai) unconfigured.add('openai');
    if (!loadedSettings.anthropic) unconfigured.add('anthropic');
    if (!loadedSettings.deepseek) unconfigured.add('deepseek');
    if (!loadedSettings.lmStudioUrl && !loadedSettings.lmStudioApiKey) unconfigured.add('lmstudio');
    return unconfigured;
  };

  // Hydrate from server DB on mount, fall back to localStorage cache
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const token = localStorage.getItem('auth_token');

      // Try to load user info
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (!cancelled) setUser({ id: payload.userId, email: payload.email });
        } catch {}
      }

      // Try DB first
      const dbSettings = token ? await loadSettingsFromDb(token) : null;

      if (dbSettings && !cancelled) {
        // DB is the source of truth
        setSettings({
          openai: dbSettings.openai || '',
          anthropic: dbSettings.anthropic || '',
          deepseek: dbSettings.deepseek || '',
          ollamaBase: dbSettings.ollamaBase || 'http://localhost:11434',
          lmStudioHost: dbSettings.lmStudioHost || 'localhost',
          lmStudioPort: dbSettings.lmStudioPort || '1234',
          lmStudioUrl: dbSettings.lmStudioUrl || '',
          lmStudioMaxModels: dbSettings.lmStudioMaxModels || '3',
          lmStudioApiKey: dbSettings.lmStudioApiKey || '',
        });
        setProviderEnabled(dbSettings.providerEnabled || { openai: false, anthropic: false, deepseek: false, ollama: true, lmstudio: false });
        setLmStudioApiKeyEnabled(dbSettings.lmStudioApiKeyEnabled ?? false);
        setRemovedProviders(new Set(dbSettings.removedProviders || []));

        // Also sync to localStorage cache
        writeSettingsToCache(dbSettings);
      } else if (!cancelled) {
        // Fall back to localStorage cache
        const cached = loadSettingsFromCache();
        setSettings({
          openai: cached.openai || '',
          anthropic: cached.anthropic || '',
          deepseek: cached.deepseek || '',
          ollamaBase: cached.ollamaBase || 'http://localhost:11434',
          lmStudioHost: cached.lmStudioHost || 'localhost',
          lmStudioPort: cached.lmStudioPort || '1234',
          lmStudioUrl: cached.lmStudioUrl || '',
          lmStudioMaxModels: cached.lmStudioMaxModels || '3',
          lmStudioApiKey: cached.lmStudioApiKey || '',
        });
        setProviderEnabled(cached.providerEnabled || { openai: false, anthropic: false, deepseek: false, ollama: true, lmstudio: false });
        setLmStudioApiKeyEnabled(cached.lmStudioApiKeyEnabled ?? false);
        // Compute removed from cached settings (missing keys = removed)
        const computedRemoved = cached.removedProviders?.length > 0
          ? new Set(cached.removedProviders)
          : getDefaultRemoved(cached);
        setRemovedProviders(computedRemoved);
      }

      if (!cancelled) setHydrated(true);
    };

    hydrate();
    return () => { cancelled = true; };
  }, [loadSettingsFromDb]);

  const handleSignOut = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
    setUserMenuOpen(false);
    router.push('/');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordCurrent || !passwordNew || !passwordConfirm) {
      setPasswordError('All fields are required');
      return;
    }
    if (passwordNew.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    if (passwordNew !== passwordConfirm) {
      setPasswordError('New passwords do not match');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) {
      setPasswordError('Not authenticated');
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: passwordCurrent,
          newPassword: passwordNew,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setPasswordSuccess('Password updated successfully');
        setPasswordCurrent('');
        setPasswordNew('');
        setPasswordConfirm('');
      } else {
        setPasswordError(data.error?.message || 'Failed to update password');
      }
    } catch {
      setPasswordError('Network error — please try again');
    } finally {
      setPasswordLoading(false);
    }
  };

  // Save provider keys to server keys table (for chat completions route compatibility)
  // Also deletes keys for providers that are disabled or have empty config
  const syncKeysToServer = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const providers = [
      { id: 'OPENAI', key: settings.openai, name: 'OpenAI API Key', providerKey: 'openai' },
      { id: 'ANTHROPIC', key: settings.anthropic, name: 'Anthropic API Key', providerKey: 'anthropic' },
      { id: 'DEEPSEEK', key: settings.deepseek, name: 'DeepSeek API Key', providerKey: 'deepseek' },
      { id: 'OLLAMA', key: settings.ollamaBase, name: 'Ollama Base URL', providerKey: 'ollama' },
      { id: 'LM_STUDIO', key: `http://${settings.lmStudioHost || 'localhost'}:${settings.lmStudioPort || '1234'}/v1`, name: 'LM Studio URL', providerKey: 'lmstudio' },
    ];
    for (const p of providers) {
      const shouldHave = p.key && p.key !== 'http://localhost:1234/v1' && providerEnabled[p.providerKey];
      if (shouldHave) {
        // Create or update the key
        try {
          await fetch('/api/auth/keys', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: p.id, name: p.name, key: p.key })
          });
        } catch {}
      } else {
        // Delete keys for unconfigured or disabled providers
        try {
          await fetch(`/api/auth/keys?provider=${encodeURIComponent(p.id)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
          });
        } catch {}
      }
    }
  };

  // Fetch billing data (usage + pricing)
  const fetchBillingData = async () => {
    setBillingLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) { setBillingLoading(false); return; }

      let startDate = null;
      const now = new Date();
      if (billingPeriod === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      } else if (billingPeriod === '7d') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (billingPeriod === '30d') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const [usageRes, pricingRes, balanceRes] = await Promise.all([
        fetch(`/api/usage?startDate=${startDate || ''}&granularity=daily`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/providers/pricing', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/providers/balance', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (usageRes.ok) {
        const data = await usageRes.json();
        setUsageData(data);
        setDailyUsage(data.daily || []);
      }
      if (pricingRes.ok) setPricingData(await pricingRes.json());
      if (balanceRes.ok) setBalanceData(await balanceRes.json());
    } catch (err) {
      console.error('[Billing] Fetch error:', err.message);
    } finally {
      setBillingLoading(false);
    }
  };

  // Fetch billing data when tab becomes active or period changes
  useEffect(() => {
    if (activeTab === 'billing') fetchBillingData();
  }, [activeTab, billingPeriod]);

  const handleSaveSettings = async (e) => {
    e?.preventDefault();
    setIsLoading(true);
    try {
      // Save to localStorage as cache
      writeSettingsToCache({
        ...settings,
        lmStudioApiKeyEnabled,
        providerEnabled,
        removedProviders: [...removedProviders],
      });

      // Save to server DB (source of truth)
      const token = localStorage.getItem('auth_token');
      if (token) {
        await saveSettingsToDb(token, buildSettingsSnapshot());
      }

      // Sync API keys to the keys table for chat completions
      await syncKeysToServer();

      // Providers that now have keys should be un-removed
      setRemovedProviders(prev => {
        const next = new Set(prev);
        if (settings.openai) next.delete('openai');
        if (settings.anthropic) next.delete('anthropic');
        if (settings.deepseek) next.delete('deepseek');
        if (settings.lmStudioApiKey || (settings.lmStudioHost !== 'localhost' || settings.lmStudioPort !== '1234')) next.delete('lmstudio');
        return next;
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleProvider = (key) => {
    setProviderEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const testProviderKey = async (providerId) => {
    setTestStatus(prev => ({ ...prev, [providerId]: 'testing' }));
    try {
      const token = localStorage.getItem('auth_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const body = { provider: providerId };
      if (providerId === 'openai') body.key = settings.openai;
      else if (providerId === 'anthropic') body.key = settings.anthropic;
      else if (providerId === 'deepseek') body.key = settings.deepseek;
      else if (providerId === 'ollama') body.baseUrl = settings.ollamaBase;
      else if (providerId === 'lmstudio') { body.host = settings.lmStudioHost; body.port = settings.lmStudioPort; body.key = settings.lmStudioApiKey; }

      const res = await fetch('/api/providers/test', { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await res.json();
      setTestStatus(prev => ({ ...prev, [providerId]: data.ok ? 'ok' : 'fail' }));
    } catch {
      setTestStatus(prev => ({ ...prev, [providerId]: 'fail' }));
    }
  };

  // Delete a provider's configuration (clears keys and removes from DB)
  const deleteProvider = async (providerId) => {
    // Compute final state synchronously
    const nextSettings = { ...settings };
    const nextProviderEnabled = { ...providerEnabled, [providerId]: false };
    const nextRemoved = new Set(removedProviders);
    nextRemoved.add(providerId);

    if (providerId === 'openai') nextSettings.openai = '';
    else if (providerId === 'anthropic') nextSettings.anthropic = '';
    else if (providerId === 'deepseek') nextSettings.deepseek = '';
    else if (providerId === 'ollama') nextSettings.ollamaBase = 'http://localhost:11434';
    else if (providerId === 'lmstudio') { nextSettings.lmStudioUrl = ''; nextSettings.lmStudioHost = 'localhost'; nextSettings.lmStudioPort = '1234'; nextSettings.lmStudioApiKey = ''; }

    const storageKeys = {
      openai: ['OPENAI_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY'],
      ollama: ['OLLAMA_API_BASE'],
      lmstudio: ['LM_STUDIO_URL', 'LM_STUDIO_HOST', 'LM_STUDIO_PORT', 'LM_STUDIO_API_KEY'],
    };
    // Clean localStorage cache
    (storageKeys[providerId] || []).forEach(k => localStorage.removeItem(k));

    // Update all state
    setSettings(nextSettings);
    setProviderEnabled(nextProviderEnabled);
    setRemovedProviders(nextRemoved);
    setTestStatus(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });

    // Persist to server DB
    const token = localStorage.getItem('auth_token');
    if (token) {
      const providerMap = {
        openai: 'OPENAI', anthropic: 'ANTHROPIC', deepseek: 'DEEPSEEK',
        ollama: 'OLLAMA', lmstudio: 'LM_STUDIO',
      };
      const dbProvider = providerMap[providerId];
      if (dbProvider) {
        try {
          await fetch(`/api/auth/keys?provider=${encodeURIComponent(dbProvider)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {}
      }
      // Save updated provider settings to DB
      const snapshot = {
        openai: nextSettings.openai,
        anthropic: nextSettings.anthropic,
        deepseek: nextSettings.deepseek,
        ollamaBase: nextSettings.ollamaBase,
        lmStudioHost: nextSettings.lmStudioHost,
        lmStudioPort: nextSettings.lmStudioPort,
        lmStudioUrl: nextSettings.lmStudioUrl,
        lmStudioMaxModels: nextSettings.lmStudioMaxModels,
        lmStudioApiKey: nextSettings.lmStudioApiKey,
        lmStudioApiKeyEnabled,
        providerEnabled: nextProviderEnabled,
        removedProviders: [...nextRemoved],
      };
      try {
        await saveSettingsToDb(token, snapshot);
        writeSettingsToCache(snapshot);
      } catch {}
    }
  };

  const tabs = [
    { id: 'providers', label: 'Providers', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    { id: 'billing', label: 'Billing', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
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

        {/* User info — deferred until localStorage auth check completes */}
        <div className="p-4 border-t border-zinc-800/40">
          {!hydrated ? (
            <div className="flex items-center gap-3 px-2 py-2 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-zinc-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-28 bg-zinc-800 rounded" />
                <div className="h-2.5 w-14 bg-zinc-800 rounded" />
              </div>
            </div>
          ) : !user ? (
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
              {!hydrated ? (
                // Skeleton placeholders prevent flash of wrong cards before localStorage loads
                <>
                  {[1,2,3,4].map(i => (
                    <div key={i} className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6 animate-pulse">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg bg-zinc-800" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 w-24 bg-zinc-800 rounded" />
                          <div className="h-3 w-40 bg-zinc-800 rounded" />
                        </div>
                      </div>
                      <div className="ml-[52px] space-y-2">
                        <div className="h-3 w-16 bg-zinc-800 rounded" />
                        <div className="h-10 bg-zinc-800/60 rounded-lg" />
                      </div>
                    </div>
                  ))}
                </>
              ) : (
              <>
              {/* OpenAI */}
              {!removedProviders.has('openai') && (
              <ProviderCard
                provider="openai" title="OpenAI" subtitle="Primary provider for chat completions"
                actionLabel="Dashboard" actionUrl="https://platform.openai.com/api-keys"
                enabled={providerEnabled.openai} onToggle={() => toggleProvider('openai')}
                testProviderId="openai" testStatus={testStatus.openai} onTest={() => testProviderKey('openai')} onDelete={() => deleteProvider('openai')}
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
              )}

              {/* Anthropic */}
              {!removedProviders.has('anthropic') && (
              <ProviderCard
                provider="anthropic" title="Anthropic" subtitle="Claude 3 model family"
                actionLabel="Console" actionUrl="https://console.anthropic.com/"
                enabled={providerEnabled.anthropic} onToggle={() => toggleProvider('anthropic')}
                testProviderId="anthropic" testStatus={testStatus.anthropic} onTest={() => testProviderKey('anthropic')} onDelete={() => deleteProvider('anthropic')}
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
              )}

              {/* DeepSeek */}
              {!removedProviders.has('deepseek') && (
              <ProviderCard
                provider="deepseek" title="DeepSeek" subtitle="OpenAI-compatible — deepseek-chat, deepseek-reasoner"
                actionLabel="Dashboard" actionUrl="https://platform.deepseek.com/api_keys"
                enabled={providerEnabled.deepseek} onToggle={() => toggleProvider('deepseek')}
                testProviderId="deepseek" testStatus={testStatus.deepseek} onTest={() => testProviderKey('deepseek')} onDelete={() => deleteProvider('deepseek')}
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
              )}

              {/* Ollama */}
              {!removedProviders.has('ollama') && (
              <ProviderCard
                provider="ollama" title="Ollama" subtitle="Local LLM models — no API key required"
                enabled={providerEnabled.ollama} onToggle={() => toggleProvider('ollama')}
                testProviderId="ollama" testStatus={testStatus.ollama} onTest={() => testProviderKey('ollama')} onDelete={() => deleteProvider('ollama')}
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
              )}

              {/* LM Studio */}
              {!removedProviders.has('lmstudio') && (
              <ProviderCard
                provider="lmstudio" title="LM Studio" subtitle="Local LLM server with GUI"
                actionLabel="Download" actionUrl="https://lmstudio.ai"
                enabled={providerEnabled.lmstudio} onToggle={() => toggleProvider('lmstudio')}
                testProviderId="lmstudio" testStatus={testStatus.lmstudio} onTest={() => testProviderKey('lmstudio')} onDelete={() => deleteProvider('lmstudio')}
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
                {/* API Key Authentication Toggle */}
                <div className="mt-4 pt-4 border-t border-zinc-800/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs text-zinc-300 font-medium">API Key Authentication</label>
                      <p className="text-[11px] text-zinc-500 mt-0.5">Most users leave this off — only enable if your instance requires it</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLmStudioApiKeyEnabled(prev => {
                          const next = !prev;
                          if (!next) {
                            setSettings(s => ({ ...s, lmStudioApiKey: '' }));
                          }
                          return next;
                        });
                      }}
                      className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        lmStudioApiKeyEnabled ? 'bg-amber-500' : 'bg-zinc-700'
                      }`}
                      role="switch"
                      aria-checked={lmStudioApiKeyEnabled}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          lmStudioApiKeyEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  {lmStudioApiKeyEnabled && (
                    <div className="mt-3">
                      <label className="block text-xs text-zinc-400 mb-1.5">API Key</label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={settings.lmStudioApiKey}
                          onChange={(e) => setSettings({ ...settings, lmStudioApiKey: e.target.value })}
                          placeholder="lm-studio-..."
                          className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-600/50"
                        />
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1">Passed as <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs">Authorization: Bearer</code> header</p>
                    </div>
                  )}
                </div>
              </ProviderCard>
              )}

              {/* Add Provider Button */}
              <button
                type="button"
                onClick={() => setAddProviderOpen(true)}
                className="w-full rounded-xl border-2 border-dashed border-zinc-700/40 px-4 py-4 text-sm text-zinc-500 hover:text-zinc-300 hover:border-zinc-600/60 hover:bg-zinc-900/30 transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add Provider
              </button>

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
            </>
              )}
            </div>
          )}

          {/* Add Provider Overlay */}
          {addProviderOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div
                className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm"
                onClick={() => setAddProviderOpen(false)}
              />
              <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                <div className="flex items-center justify-between border-b border-zinc-800/40 px-5 py-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">Add Provider</h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5">Select a provider to configure</p>
                  </div>
                  <button onClick={() => setAddProviderOpen(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="p-4 space-y-2">
                  {[
                    { id: 'openai', name: 'OpenAI', desc: 'GPT-4o, GPT-4, GPT-3.5', color: 'emerald', enabled: providerEnabled.openai,
                      icon: PROVIDER_ICONS.openai
                    },
                    { id: 'anthropic', name: 'Anthropic', desc: 'Claude 3 Opus, Sonnet, Haiku', color: 'violet', enabled: providerEnabled.anthropic,
                      icon: PROVIDER_ICONS.anthropic
                    },
                    { id: 'deepseek', name: 'DeepSeek', desc: 'deepseek-chat, deepseek-reasoner', color: 'teal', enabled: providerEnabled.deepseek,
                      icon: PROVIDER_ICONS.deepseek
                    },
                    { id: 'ollama', name: 'Ollama', desc: 'Local Llama, Mistral, Gemma models', color: 'green', enabled: providerEnabled.ollama,
                      icon: PROVIDER_ICONS.ollama
                    },
                    { id: 'lmstudio', name: 'LM Studio', desc: 'Local LLM server with GUI', color: 'amber', enabled: providerEnabled.lmstudio,
                      icon: PROVIDER_ICONS.lmstudio
                    }
                  ].map(p => {
                    const alreadyEnabled = p.enabled;
                    const colorMap = {
                      emerald: 'hover:bg-emerald-500/10 hover:border-emerald-500/20',
                      violet: 'hover:bg-violet-500/10 hover:border-violet-500/20',
                      teal: 'hover:bg-teal-500/10 hover:border-teal-500/20',
                      green: 'hover:bg-green-500/10 hover:border-green-500/20',
                      amber: 'hover:bg-amber-500/10 hover:border-amber-500/20'
                    };
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          if (!alreadyEnabled) {
                            toggleProvider(p.id);
                            // If this provider was previously removed, bring it back
                            if (removedProviders.has(p.id)) {
                              setRemovedProviders(prev => {
                                const next = new Set(prev);
                                next.delete(p.id);
                                localStorage.setItem('PROVIDER_REMOVED', JSON.stringify([...next]));
                                return next;
                              });
                            }
                          }
                        }}
                        disabled={alreadyEnabled}
                        className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-left transition-all border ${
                          alreadyEnabled
                            ? 'bg-zinc-800/30 border-zinc-700/30 opacity-40 cursor-not-allowed'
                            : `bg-zinc-800/40 border-zinc-700/40 ${colorMap[p.color]}`
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          p.color === 'emerald' ? 'bg-emerald-400/10 text-emerald-400'
                          : p.color === 'violet' ? 'bg-violet-400/10 text-violet-400'
                          : p.color === 'teal' ? 'bg-teal-400/10 text-teal-400'
                          : p.color === 'green' ? 'bg-green-400/10 text-green-400'
                          : 'bg-amber-400/10 text-amber-400'
                        }`}>
                          {p.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-200">{p.name}</p>
                          <p className="text-xs text-zinc-500 truncate">{p.desc}</p>
                        </div>
                        {alreadyEnabled ? (
                          <span className="text-[10px] text-zinc-600 font-medium px-2 py-0.5 rounded-full bg-zinc-800">Added</span>
                        ) : (
                          <span className="text-[10px] text-zinc-500 font-medium">Add →</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-zinc-800/40 px-5 py-3">
                  <p className="text-[10px] text-zinc-600">
                    Enabled providers appear dimmed. Deleted providers can be re-added here.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ===== BILLING TAB ===== */}
          {activeTab === 'billing' && (
            <BillingTab
              period={billingPeriod}
              onPeriodChange={setBillingPeriod}
              usageData={usageData}
              dailyUsage={dailyUsage}
              pricingData={pricingData}
              balanceData={balanceData}
              loading={billingLoading}
            />
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
                <h3 className="text-base font-medium text-white mb-2">Reset Password</h3>
                <p className="text-sm text-zinc-500 mb-4">Change your account password.</p>
                <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Current Password</label>
                    <input
                      type="password"
                      value={passwordCurrent}
                      onChange={(e) => { setPasswordCurrent(e.target.value); setPasswordError(''); setPasswordSuccess(''); }}
                      placeholder="Enter current password"
                      className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">New Password</label>
                    <input
                      type="password"
                      value={passwordNew}
                      onChange={(e) => { setPasswordNew(e.target.value); setPasswordError(''); setPasswordSuccess(''); }}
                      placeholder="At least 8 characters"
                      className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      value={passwordConfirm}
                      onChange={(e) => { setPasswordConfirm(e.target.value); setPasswordError(''); setPasswordSuccess(''); }}
                      placeholder="Re-enter new password"
                      className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
                    />
                  </div>
                  {passwordError && (
                    <p className="text-sm text-red-400">{passwordError}</p>
                  )}
                  {passwordSuccess && (
                    <p className="text-sm text-emerald-400">{passwordSuccess}</p>
                  )}
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {passwordLoading ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
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
                  <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center">
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
// Shared provider icon map — used by both ProviderCard and Add Provider overlay
const PROVIDER_ICONS = {
  openai: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 4.5c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6-2.7-6-6-6zm-11 0c-3.3 0-6 2.7-6 6s2.7 6 6 6c1.4 0 2.7-.5 3.8-1.3-.9-1.4-1.4-3-1.4-4.7s.5-3.3 1.4-4.7c-1.1-.8-2.4-1.3-3.8-1.3z"/></svg>,
  anthropic: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
  deepseek: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>,
  ollama: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z"/></svg>,
  lmstudio: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round"/><path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4"/></svg>,
};

const PROVIDER_COLORS = {
  openai: { bg: 'bg-emerald-400/10', text: 'text-emerald-400', accent: 'bg-emerald-500', ring: 'ring-emerald-500/30' },
  anthropic: { bg: 'bg-violet-400/10', text: 'text-violet-400', accent: 'bg-violet-500', ring: 'ring-violet-500/30' },
  deepseek: { bg: 'bg-teal-400/10', text: 'text-teal-400', accent: 'bg-teal-500', ring: 'ring-teal-500/30' },
  ollama: { bg: 'bg-green-400/10', text: 'text-green-400', accent: 'bg-green-500', ring: 'ring-green-500/30' },
  lmstudio: { bg: 'bg-amber-400/10', text: 'text-amber-400', accent: 'bg-amber-500', ring: 'ring-amber-500/30' },
};

function ProviderCard({ provider, title, subtitle, actionLabel, actionUrl, enabled, onToggle, children, testProviderId, testStatus, onTest, onDelete }) {
  const c = PROVIDER_COLORS[provider] || PROVIDER_COLORS.openai;
  const icon = PROVIDER_ICONS[provider] || PROVIDER_ICONS.openai;
  const testing = testStatus === 'testing';
  const testOk = testStatus === 'ok';
  const testFail = testStatus === 'fail';

  return (
    <div className={`bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6 transition-all ${!enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-white">{title}</h3>
          <p className="text-sm text-zinc-500">{subtitle}</p>
        </div>
        {/* Toggle Switch */}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              enabled ? c.accent : 'bg-zinc-700'
            }`}
            role="switch"
            aria-checked={enabled}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        )}
        {/* Test Button */}
        {onTest && enabled && (
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 ${
              testOk
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : testFail
                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 border border-zinc-700/40'
            } disabled:opacity-60`}
          >
            {testing ? (
              <><svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg> Testing</>
            ) : testOk ? (
              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg> Valid</>
            ) : testFail ? (
              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg> Failed</>
            ) : (
              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Test</>
            )}
          </button>
        )}
        {/* Delete Provider */}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title={`Remove ${title}`}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        )}
      </div>
      <div className={`ml-[52px] ${!enabled ? 'pointer-events-none' : ''}`}>
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

// SVG Usage Graph — stacked bar chart of daily tokens by provider
function UsageGraph({ dailyUsage, fmtTokens }) {
  const providerColors = {
    openai: '#818cf8',      // indigo-400
    anthropic: '#c084fc',   // purple-400
    deepseek: '#2dd4bf',    // teal-400
    ollama: '#4ade80',      // green-400
    lmstudio: '#fb923c',    // orange-400
  };
  const providerNames = {
    openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek',
    ollama: 'Ollama', lmstudio: 'LM Studio',
  };

  // Group by date
  const dateMap = {};
  for (const row of dailyUsage) {
    if (!dateMap[row.date]) dateMap[row.date] = {};
    dateMap[row.date][row.provider] = (dateMap[row.date][row.provider] || 0) + row.totalTokens;
  }
  const dates = Object.keys(dateMap).sort();

  // Collect all providers that appear
  const providers = new Set();
  for (const row of dailyUsage) providers.add(row.provider);
  const providerList = [...providers];

  // Chart dimensions
  const padding = { top: 10, right: 10, bottom: 28, left: 42 };
  const width = 600;
  const height = 180;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Find max daily total
  let maxTotal = 0;
  for (const d of dates) {
    let sum = 0;
    for (const p of providerList) sum += dateMap[d][p] || 0;
    if (sum > maxTotal) maxTotal = sum;
  }
  if (maxTotal === 0) maxTotal = 1;

  // Y-axis ticks
  const yTicks = 4;
  const barW = Math.max(2, Math.min(chartW / Math.max(dates.length, 1) - 4, 24));

  return (
    <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5">
      <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Daily Token Usage</h3>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[400px]" style={{ maxHeight: 200 }}>
          {/* Y-axis gridlines & labels */}
          {Array.from({ length: yTicks }, (_, i) => {
            const val = Math.round((maxTotal / yTicks) * (i + 1));
            const y = padding.top + chartH - (chartH / yTicks) * (i + 1);
            return (
              <g key={`y-${i}`}>
                <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#27272a" strokeWidth={0.5} />
                <text x={padding.left - 4} y={y + 3} textAnchor="end" fill="#71717a" fontSize={9}>
                  {fmtTokens(val)}
                </text>
              </g>
            );
          })}
          {/* Bars */}
          {dates.map((date, di) => {
            const x = padding.left + (chartW / Math.max(dates.length, 1)) * di + 2;
            let yOffset = padding.top + chartH;
            return (
              <g key={date}>
                {providerList.map(prov => {
                  const tokens = dateMap[date][prov] || 0;
                  if (tokens === 0) return null;
                  const barH = (tokens / maxTotal) * chartH;
                  yOffset -= barH;
                  const bar = (
                    <rect
                      key={prov}
                      x={x}
                      y={yOffset}
                      width={barW}
                      height={barH}
                      fill={providerColors[prov] || '#71717a'}
                      rx={1}
                    >
                      <title>{`${providerNames[prov] || prov}: ${fmtTokens(tokens)}`}</title>
                    </rect>
                  );
                  return bar;
                })}
                {/* Date label */}
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" fill="#71717a" fontSize={8}>
                  {date.slice(5)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Legend */}
      {providerList.length > 0 && (
        <div className="flex flex-wrap gap-4 mt-3 justify-center">
          {providerList.map(prov => (
            <div key={prov} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: providerColors[prov] || '#71717a' }} />
              <span className="text-[11px] text-zinc-400">{providerNames[prov] || prov}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Billing tab component — shows usage, cost breakdowns, and savings
function BillingTab({ period, onPeriodChange, usageData, dailyUsage, pricingData, balanceData, loading }) {
  const periods = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 Days' },
    { id: '30d', label: '30 Days' },
    { id: 'all', label: 'All Time' },
  ];

  // Build a pricing lookup: { 'openai/gpt-4o': { input, output } }
  const pricingLookup = {};
  if (pricingData?.models) {
    for (const p of pricingData.models) {
      const key = `${p.provider}/${p.model}`;
      if (!pricingLookup[key] || pricingLookup[key].input === 0) {
        pricingLookup[key] = { provider: p.provider, model: p.model, input: p.input, output: p.output };
      }
    }
  }

  // Helper: get pricing for a provider+model combination (exact first, then wildcard, then cross-provider)
  const getPricing = (provider, model) => {
    // Exact match
    const exact = pricingLookup[`${provider}/${model}`];
    if (exact && exact.input > 0) return exact;
    // Wildcard match for same provider
    const wildcard = pricingLookup[`${provider}/*`];
    if (wildcard && wildcard.input > 0) return wildcard;
    // Cross-provider fallback: if the model name suggests a different provider, try that
    if (model.startsWith('deepseek-') && provider !== 'deepseek') {
      const crossExact = pricingLookup[`deepseek/${model}`];
      if (crossExact && crossExact.input > 0) return crossExact;
      const crossWildcard = pricingLookup[`deepseek/*`];
      if (crossWildcard && crossWildcard.input > 0) return crossWildcard;
    }
    // Return existing wildcard even if input=0 (for ollama/lmstudio free local models)
    if (wildcard) return wildcard;
    return { input: 0, output: 0 };
  };

  // Compute costs from usage data (with DeepSeek cache hit discount: hit tokens = 10% of input price)
  const computeCosts = () => {
    if (!usageData?.byProvider) return { providerBreakdown: [], totalCost: 0, cloudSavings: 0 };
    const breakdown = [];
    let totalCost = 0;

    for (const [provider, data] of Object.entries(usageData.byProvider)) {
      let providerCost = 0;
      const models = [];

      for (const [model, modelData] of Object.entries(data.byModel)) {
        const prices = getPricing(provider, model);
        const cacheHitTokens = modelData.promptCacheHitTokens || 0;
        const cacheMissTokens = modelData.promptCacheMissTokens || 0;
        // If cache fields are populated, split prompt tokens; otherwise treat all as miss tokens
        const hasCacheData = (cacheHitTokens + cacheMissTokens) > 0;
        const effectiveMiss = hasCacheData ? cacheMissTokens : modelData.promptTokens;
        const effectiveHit = hasCacheData ? cacheHitTokens : 0;
        // Cache hits cost 10% of input price
        const cacheHitPrice = prices.input * 0.1;
        const cost = (
          (effectiveMiss * prices.input) +
          (effectiveHit * cacheHitPrice) +
          (modelData.completionTokens * prices.output)
        ) / 1_000_000;
        providerCost += cost;
        models.push({
          model,
          promptTokens: modelData.promptTokens,
          completionTokens: modelData.completionTokens,
          totalTokens: modelData.totalTokens,
          requestCount: modelData.requestCount,
          inputPrice: prices.input,
          outputPrice: prices.output,
          cost,
          cacheHitTokens: effectiveHit,
          cacheMissTokens: effectiveMiss,
          cacheSavings: effectiveHit > 0 ? (effectiveHit * prices.input * 0.9) / 1_000_000 : 0,
        });
      }

      breakdown.push({
        provider,
        totalTokens: data.totalTokens,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        requestCount: data.requestCount,
        models,
        cost: providerCost,
      });
      totalCost += providerCost;
    }

    // Sort by cost descending
    breakdown.sort((a, b) => b.cost - a.cost);

    return { providerBreakdown: breakdown, totalCost };
  };

  const { providerBreakdown, totalCost } = computeCosts();
  const cloudProviders = providerBreakdown.filter(p => p.provider !== 'ollama' && p.provider !== 'lmstudio');
  const localProviders = providerBreakdown.filter(p => p.provider === 'ollama' || p.provider === 'lmstudio');
  const localTokens = localProviders.reduce((sum, p) => sum + p.totalTokens, 0);

  // Estimate what local tokens would have cost if run via cheapest cloud (gpt-4o-mini)
  const estimatedSavings = (localTokens / 1_000_000) * (0.15 + 0.60); // gpt-4o-mini in+out

  // Format helpers
  const fmtTokens = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const fmtCost = (n) => `$${n.toFixed(n < 0.01 ? 4 : 2)}`;

  if (loading) {
    return (
      <div className="max-w-3xl space-y-5">
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-zinc-500">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">Loading billing data…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* Period Selector */}
      <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800/40 rounded-lg p-1 w-fit">
        {periods.map(p => (
          <button
            key={p.id}
            onClick={() => onPeriodChange(p.id)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              period === p.id
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Balance Cards */}
      {balanceData?.providers?.deepseek && (
        <div className="bg-gradient-to-r from-emerald-950/30 to-indigo-950/20 border border-zinc-800/40 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-600/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-zinc-400">DeepSeek Balance</p>
                {balanceData.providers.deepseek.available ? (
                  <p className="text-lg font-semibold text-emerald-400">
                    ${balanceData.providers.deepseek.totalAvailable.toFixed(2)}
                    <span className="text-xs text-zinc-500 font-normal ml-1">
                      {balanceData.providers.deepseek.currency}
                    </span>
                  </p>
                ) : balanceData.providers.deepseek.reason === 'no_key' ? (
                  <p className="text-sm text-zinc-500">Add API key in Providers</p>
                ) : (
                  <p className="text-sm text-amber-400">Balance unavailable</p>
                )}
              </div>
            </div>
            {balanceData.providers.deepseek.available && balanceData.providers.deepseek.grantedBalance > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-zinc-500">Granted</p>
                <p className="text-xs text-zinc-400">${balanceData.providers.deepseek.grantedBalance.toFixed(2)}</p>
              </div>
            )}
          </div>
          {balanceData.providers.deepseek.available && (
            <div className="mt-2 pt-2 border-t border-zinc-800/40 flex gap-3 text-[10px] text-zinc-600">
              <span>Topped-up: ${balanceData.providers.deepseek.toppedUpBalance.toFixed(2)}</span>
              {balanceData.providers.deepseek.grantedBalance > 0 && (
                <span>Granted: ${balanceData.providers.deepseek.grantedBalance.toFixed(2)}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5">
          <p className="text-xs text-zinc-500 mb-1">Total Cost</p>
          <p className="text-2xl font-semibold text-white">{fmtCost(totalCost)}</p>
          <p className="text-xs text-zinc-600 mt-1">{period !== 'all' ? `This ${period}` : 'All time'}</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5">
          <p className="text-xs text-zinc-500 mb-1">Total Tokens</p>
          <p className="text-2xl font-semibold text-white">{fmtTokens(usageData?.totalTokens || 0)}</p>
          <p className="text-xs text-zinc-600 mt-1">{usageData?.totalRequests || 0} requests</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5">
          <p className="text-xs text-zinc-500 mb-1">Local Savings</p>
          <p className="text-2xl font-semibold text-green-400">{fmtCost(estimatedSavings)}</p>
          <p className="text-xs text-zinc-600 mt-1">{fmtTokens(localTokens)} via local models</p>
        </div>
      </div>

      {/* Usage Graph — daily token consumption stacked by provider */}
      {dailyUsage && dailyUsage.length > 0 ? (
        <UsageGraph dailyUsage={dailyUsage} fmtTokens={fmtTokens} />
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-8 text-center">
          <svg className="w-8 h-8 text-zinc-700 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M3 3v18h18M7 16l4-8 4 4 4-6" />
          </svg>
          <p className="text-zinc-500 text-sm">No daily usage data yet</p>
          <p className="text-zinc-600 text-xs mt-1">Usage graph will appear after you start chatting</p>
        </div>
      )}

      {/* Savings Highlight */}
      {localProviders.length > 0 && (
        <div className="bg-green-950/20 border border-green-800/30 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-medium text-green-400">Local Model Savings</h4>
              <p className="text-xs text-green-600/80 mt-1">
                You processed {fmtTokens(localTokens)} tokens via local models ({localProviders.map(p => p.provider).join(', ')}),
                saving an estimated {fmtCost(estimatedSavings)} compared to running the same workload through a cloud provider.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Provider Breakdown */}
      {providerBreakdown.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Provider Breakdown</h3>
          {providerBreakdown.map(pb => (
            <div key={pb.provider} className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white capitalize">{pb.provider}</span>
                  <span className="text-xs text-zinc-500">{pb.requestCount} requests</span>
                </div>
                <span className="text-sm font-semibold text-white">{fmtCost(pb.cost)}</span>
              </div>

              {/* Model rows */}
              <div className="space-y-2">
                {pb.models.map(m => (
                  <div key={m.model} className="flex items-center justify-between text-sm bg-zinc-800/40 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-zinc-300 truncate block">{m.model}</span>
                      <span className="text-xs text-zinc-500">
                        {fmtTokens(m.promptTokens)} in · {fmtTokens(m.completionTokens)} out · {m.requestCount} req
                        {m.cacheHitTokens > 0 && (
                          <span className="text-emerald-600"> · {fmtTokens(m.cacheHitTokens)} cached (10% cost)</span>
                        )}
                      </span>
                    </div>
                    <div className="text-right ml-4">
                      <span className="text-zinc-200 font-mono text-xs">{fmtCost(m.cost)}</span>
                      {m.cacheSavings > 0 && (
                        <span className="block text-[10px] text-emerald-600">-{fmtCost(m.cacheSavings)}</span>
                      )}
                      {(m.inputPrice > 0 || m.outputPrice > 0) && (
                        <span className="block text-[10px] text-zinc-600">
                          ${m.inputPrice}/M in · ${m.outputPrice}/M out
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Session tokens bar */}
              <div className="mt-3 flex items-center gap-1.5">
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden flex">
                  {pb.promptTokens > 0 && (
                    <div className="bg-indigo-500/60 h-full" style={{ width: `${(pb.promptTokens / pb.totalTokens) * 100}%` }} />
                  )}
                  {pb.completionTokens > 0 && (
                    <div className="bg-purple-500/60 h-full" style={{ width: `${(pb.completionTokens / pb.totalTokens) * 100}%` }} />
                  )}
                </div>
              </div>
              <div className="flex gap-3 text-[10px] text-zinc-600 mt-1">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500/60" /> Input</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500/60" /> Output</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-10 text-center">
          <svg className="w-10 h-10 text-zinc-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-zinc-500 text-sm">No usage data yet</p>
          <p className="text-zinc-600 text-xs mt-1">Start chatting to see your usage here</p>
        </div>
      )}


    </div>
  );
}
