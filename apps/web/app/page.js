// @aurora/web - Main Chat Page with streaming, thinking process, and vision support
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

export default function Home() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [providerId, setProviderId] = useState('openai');
  const [thoughtProcess, setThoughtProcess] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [chatList, setChatList] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isThinking]);

  // Initialize app: check auth and load models on mount
  useEffect(() => {
    const init = async () => {
      await checkAuth();
      setModelsLoading(false);
    };
    init();
  }, []);

  // Hydrate localStorage with provider keys from Redis on login.
  // Only fills missing keys — localStorage is canonical, Redis is backup.
  const hydrateKeysFromServer = async (token) => {
    try {
      const res = await fetch('/api/auth/keys', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const keys = data.keys || [];
      // Only restore keys from Redis if the server has them.
      // localStorage values take priority for fields not returned by Redis.
      for (const k of keys) {
        if (k.rawKey) {
          const storageKey = k.provider === 'OLLAMA' ? 'OLLAMA_API_BASE'
            : k.provider === 'LM_STUDIO' ? 'LM_STUDIO_URL'
            : k.provider === 'DEEPSEEK' ? 'DEEPSEEK_API_KEY'
            : `${k.provider.toUpperCase()}_API_KEY`;
          // Never overwrite — localStorage is the source of truth
          if (!localStorage.getItem(storageKey)) {
            localStorage.setItem(storageKey, k.rawKey);
          }
        }
      }
    } catch { /* Server unavailable — rely on localStorage */ }
  };

  // Returns true if models were successfully loaded, false otherwise
  const getModelsFromStorage = async () => {
    setModelsLoading(true);
    try {
      // Build headers with any available API keys from localStorage
      const headers = {};
      const token = localStorage.getItem('auth_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
      const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
      const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      
      if (openaiKey) headers['x-openai-key'] = openaiKey;
      if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
      if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
      if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
      if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;

      // Try the models API with a 10-second timeout (prevents hung Ollama from freezing UI)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const modelsRes = await fetch('/api/providers/models', { 
          headers, 
          signal: controller.signal 
        });
        clearTimeout(timeoutId);
        
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          if (modelsData.models && modelsData.models.length > 0) {
            setAvailableModels(modelsData.models);
            const defaultModel = modelsData.models[0];
            setModel(defaultModel.id);
            setProviderId(
              defaultModel.source === 'Ollama' ? 'ollama' 
              : defaultModel.source === 'Anthropic' ? 'anthropic' 
              : defaultModel.source === 'LM Studio' ? 'lmstudio'
              : defaultModel.source === 'DeepSeek' ? 'deepseek'
              : 'openai'
            );
            return true;
          }
          // Successful response but empty models — clear if anything was stale
          setAvailableModels([]);
          return false;
        }
        // Non-ok response — don't clear existing models
        return false;
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        // Network error (server restart etc.) — keep existing models
        console.error('Models API fetch failed:', fetchErr.message);
        return false;
      }

    } catch (error) {
      console.error('Fetch models error:', error.message);
      return false;
    } finally {
      setModelsLoading(false);
    }
  };

  const checkAuth = async () => {
    const token = localStorage.getItem('auth_token');
    
    if (!token) {
      setUser(null);
    } else {
      // Decode JWT to extract user info from the token payload
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({ id: payload.userId, email: payload.email, name: payload.sub });
        // Hydrate localStorage with provider keys from Redis server
        await hydrateKeysFromServer(token);
      } catch {
        // Invalid token format — clear it
        localStorage.removeItem('auth_token');
        setUser(null);
      }
    }

    let modelsLoaded = false;
    try {
      modelsLoaded = await getModelsFromStorage();
    } catch (modelError) {
      console.debug('Failed to fetch models:', modelError.message);
    }

    // If no models after initial fetch (server was restarting), retry after delays
    if (!modelsLoaded && localStorage.getItem('auth_token')) {
      // Helper to build full headers from localStorage (same as getModelsFromStorage)
      const retryFetch = async () => {
        if (!localStorage.getItem('auth_token')) return false;
        const headers = { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` };
        const openaiKey = localStorage.getItem('OPENAI_API_KEY');
        const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
        const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
        const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
        const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
        if (openaiKey) headers['x-openai-key'] = openaiKey;
        if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
        if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
        if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
        if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
        try {
          const res = await fetch('/api/providers/models', { headers });
          if (res.ok) {
            const data = await res.json();
            if (data.models?.length > 0) {
              setAvailableModels(data.models);
              setModel(data.models[0].id);
              return true;
            }
          }
        } catch {}
        return false;
      };
      setTimeout(async () => {
        const ok = await retryFetch();
        // Second retry after 5 more seconds if still no models
        if (!ok) {
          setTimeout(() => retryFetch(), 5000);
        }
      }, 2000);
    }

    // Load existing chats
    loadChats();
  };

  const loadChats = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch('/api/chats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChatList(data.chats || []);
      }
    } catch (e) {
      console.debug('Load chats error:', e.message);
    }
  };

  const newChat = async () => {
    setMessages([]);
    setInputValue('');
    setCurrentChatId(null);
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat', model })
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentChatId(data.id);
        loadChats();
      }
    } catch (e) {
      console.debug('New chat error:', e.message);
    }
  };

  const renameChat = async (chatId, newTitle) => {
    if (!newTitle.trim()) return;
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() })
      });
      loadChats();
    } catch (e) {
      console.debug('Rename chat error:', e.message);
    }
  };

  const deleteChat = async (chatId) => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        if (currentChatId === chatId) {
          setCurrentChatId(null);
          setMessages([]);
        }
        loadChats();
      }
    } catch (e) {
      console.debug('Delete chat error:', e.message);
    }
  };

  const openChat = async (chatId) => {
    setCurrentChatId(chatId);
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const res = await fetch(`/api/chats/${chatId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        // Restore model/provider from the chat so responses use the same model
        if (data.modelId) setModel(data.modelId);
        if (data.provider) setProviderId(data.provider);
      }
    } catch (e) {
      console.debug('Open chat error:', e.message);
    }
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    if (!user) {
      setAuthModalOpen(true);
      return;
    }

    // LM Studio guard: check model limit before doing anything else
    // Models only load on first chat request, not on dropdown selection
    if (providerId === 'lmstudio') {
      const canSend = await guardLmStudioSend();
      if (!canSend) return;
    }

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setThoughtProcess([]);

    // Auto-create a chat if none is active
    let chatId = currentChatId;
    if (!chatId) {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          const chatRes = await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: inputValue.slice(0, 60), model })
          });
          if (chatRes.ok) {
            const chatData = await chatRes.json();
            chatId = chatData.id;
            setCurrentChatId(chatId);
            loadChats();
          }
        }
      } catch {}
    }

    // Persist user message to chat
    if (chatId) {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          await fetch(`/api/chats/${chatId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content: inputValue, model, provider: providerId })
          });
        }
      } catch {}
    }

    try {
      // Build messages array: include chat history for context when resuming a chat
      let messagesArray;
      if (currentChatId) {
        // Resuming a chat — send last 50 messages as context to the LLM
        const historyMessages = messages.map(m => ({ role: m.role, content: m.content }));
        messagesArray = [...historyMessages.slice(-50), { role: 'user', content: inputValue }];
      } else {
        messagesArray = [{ role: 'user', content: inputValue }];
      }
      
      // Build headers with API keys from localStorage
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('auth_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
      const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
      const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      
      if (openaiKey) headers['x-openai-key'] = openaiKey;
      if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
      if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
      if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
      if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
      
      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: messagesArray,
          temperature: 0.7,
          top_p: 1,
          max_tokens: null,
          provider: providerId
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Failed to get response from ${model}`);
      }

      const data = await res.json();
      
      let content = '';
      if (data.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content;
      } else if (data.choices?.[0]?.delta?.content) {
        content = data.choices[0].delta.content;
      }

      const thoughtText = data.choices?.[0]?.message?.thinking || '';
      if (thoughtText) {
        setThoughtProcess(prev => [...prev, { type: 'thinking', content: thoughtText }]);
      }

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        model: data.model || model,
        provider: providerId,
        usage: data.usage
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Persist assistant message to chat
      if (chatId && content) {
        try {
          const token = localStorage.getItem('auth_token');
          if (token) {
            await fetch(`/api/chats/${chatId}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'assistant', content, model: data.model || model, provider: providerId })
            });
          }
        } catch {}
      }

    } catch (error) {
      console.error('Chat error:', error.message);
      setErrorMessage(error.message);
      setTimeout(() => setErrorMessage(''), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const fileInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [hoveredChatId, setHoveredChatId] = useState(null);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [modelOverlayOpen, setModelOverlayOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelProviderFilter, setModelProviderFilter] = useState('all');

  // Close model overlay on Escape
  useEffect(() => {
    if (!modelOverlayOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setModelOverlayOpen(false);
        setModelSearch('');
        setModelProviderFilter('all');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modelOverlayOpen]);

  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // LM Studio model limit overlay
  const [lmOverlayOpen, setLmOverlayOpen] = useState(false);
  const [lmLoadedModels, setLmLoadedModels] = useState([]);

  const handleSignOut = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('OPENAI_API_KEY');
    localStorage.removeItem('ANTHROPIC_API_KEY');
    localStorage.removeItem('OLLAMA_API_BASE');
    localStorage.removeItem('LM_STUDIO_URL');
    setUser(null);
    setMessages([]);
    setCurrentChatId(null);
    setChatList([]);
    setAvailableModels([]);
    setModel('');
    setUserMenuOpen(false);
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');

    if (!authEmail.trim() || !authPassword) {
      setAuthError('Email and password are required.');
      return;
    }
    if (authMode === 'register' && authPassword !== authConfirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    if (authMode === 'register' && authPassword.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const endpoint = authMode === 'signin' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Authentication failed.');

      if (data.token) {
        localStorage.setItem('auth_token', data.token);
        const payload = JSON.parse(atob(data.token.split('.')[1]));
        setUser({ id: payload.userId, email: payload.email, name: payload.sub });
        setAuthModalOpen(false);
        setAuthEmail('');
        setAuthPassword('');
        setAuthConfirmPassword('');
        // Restore provider keys from Redis and load models
        await hydrateKeysFromServer(data.token);
        await getModelsFromStorage();
        loadChats();
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  // Guard LM Studio sends: if selected model isn't loaded and limit is reached, ask user to unload
  const guardLmStudioSend = async () => {
    if (providerId !== 'lmstudio') return true;
    const max = parseInt(localStorage.getItem('LM_STUDIO_MAX_MODELS') || '0', 10);
    if (!max || max <= 0) return true;

    const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
    if (!lmStudioUrl) return true;

    try {
      const base = lmStudioUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
      const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return true;
      const data = await res.json();
      const loaded = data.data || (Array.isArray(data) ? data : []);

      // If selected model is already loaded, allow
      if (loaded.some(m => m.id === model)) return true;
      // If under limit, LM Studio will load it on the chat request
      if (loaded.length < max) return true;

      // Over limit — show overlay asking user to free a slot
      setLmLoadedModels(loaded);
      setLmOverlayOpen(true);
      return false;
    } catch {
      return true;
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside className={`w-[260px] flex-shrink-0 flex flex-col border-r border-zinc-800/40 bg-zinc-900 hidden md:flex`}>        {/* Aurora Logo — static brand */}
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
        <div className="flex-1 overflow-y-auto py-3">
          <button 
            onClick={newChat} 
            className={`w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm transition-colors bg-indigo-600/10 text-white hover:bg-indigo-600/20`}
          >
            <svg className="w-[1.2rem] h-[1.2rem] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            New chat
          </button>

          {/* Model selector — inline in sidebar with aurora-gradient status blip */}
          {user ? (
            <button 
              onClick={() => { setModelOverlayOpen(true); if (availableModels.length === 0) getModelsFromStorage(); }}
              className="w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm transition-colors text-zinc-400 hover:text-white hover:bg-zinc-800/20 mt-0.5"
            >
              <svg className="w-[1.2rem] h-[1.2rem] shrink-0 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" strokeWidth={1.5} /><path d="M8 21h8" strokeWidth={1.5} strokeLinecap="round" /><path d="M12 17v4" strokeWidth={1.5} strokeLinecap="round" /></svg>
              <span className="truncate flex-1 text-left">{modelsLoading ? 'Loading...' : (model || 'Select a model')}</span>
              <span className="relative flex items-center justify-center w-[1.2rem] h-[1.2rem] shrink-0">
                <span className="absolute inset-0 rounded-full opacity-30 blur-[3px]" style={{ background: 'linear-gradient(135deg, #818cf8, #c084fc, #f0abfc)' }} />
                <span className="relative w-2 h-2 rounded-full" style={{ background: 'linear-gradient(135deg, #818cf8, #e879f9)' }} />
              </span>
            </button>
          ) : (
            <div className="w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-600 mt-0.5 cursor-not-allowed select-none">
              <svg className="w-[1.2rem] h-[1.2rem] shrink-0 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" strokeWidth={1.5} /><path d="M8 21h8" strokeWidth={1.5} strokeLinecap="round" /><path d="M12 17v4" strokeWidth={1.5} strokeLinecap="round" /></svg>
              <span className="truncate flex-1 text-left">Sign in to load models</span>
              <span className="relative flex items-center justify-center w-[1.2rem] h-[1.2rem] shrink-0">
                <span className="absolute inset-0 rounded-full opacity-15 blur-[3px]" style={{ background: 'linear-gradient(135deg, #52525b, #3f3f46, #52525b)' }} />
                <span className="relative w-2 h-2 rounded-full bg-zinc-600" />
              </span>
            </div>
          )}

          <div className="my-2 border-t border-zinc-800/40"></div>

          <nav className="space-y-[calc(0.75rem+3px)]">
            {chatList.length === 0 ? (
              <p className="px-4 py-2 text-xs text-zinc-600">No chats yet. Start a conversation!</p>
            ) : (
              chatList.map((chat) => (
                <div
                  key={chat.id}
                  className="relative group"
                  onMouseEnter={() => setHoveredChatId(chat.id)}
                  onMouseLeave={() => setHoveredChatId(null)}
                >
                  {renamingChatId === chat.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameChat(chat.id, renameValue);
                        setRenamingChatId(null);
                        setRenameValue('');
                      }}
                      className="w-full flex items-center gap-2 px-4 py-[calc(0.75rem+6px)]"
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => { setRenamingChatId(null); setRenameValue(''); }}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setRenamingChatId(null); setRenameValue(''); } }}
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-indigo-500"
                      />
                    </form>
                  ) : (
                    <button
                      onClick={() => openChat(chat.id)}
                      className={`w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-left transition-colors ${
                        currentChatId === chat.id ? 'bg-indigo-600/15 text-white' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20'
                      }`}
                    >
                      <svg className="w-[1.2rem] h-[1.2rem] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm">{chat.title || 'Chat'}</p>
                      </div>
                    </button>
                  )}
                  {hoveredChatId === chat.id && !renamingChatId && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingChatId(chat.id); setRenameValue(chat.title || ''); }}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
                        title="Rename"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${chat.title || 'Chat'}"?`)) deleteChat(chat.id); }}
                        className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/20 transition-colors"
                        title="Delete"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </nav>
        </div>

        <div className="p-4 border-t border-zinc-800/40">
          {!user ? (
            <button
              onClick={() => setAuthModalOpen(true)}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition-colors flex items-center justify-center"
            >
              Sign In
            </button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-medium">
                  {user.name?.[0] || user.email[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                  <p className="text-xs text-zinc-500">Free Plan</p>
                </div>
                <svg className={`w-4 h-4 text-zinc-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>

              {/* Drop-up Menu */}
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-850 border border-zinc-700/50 rounded-xl shadow-2xl z-20 py-1.5">
                    <a href="/settings" className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors" onClick={() => setUserMenuOpen(false)}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Settings
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

      {/* Error Toast */}
      {errorMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-700/50 text-red-200 px-6 py-3 rounded-xl shadow-2xl text-sm flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="ml-2 hover:text-white flex-shrink-0">&times;</button>
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header with model selector */}
        <header className="fixed top-0 left-26 right-0 h-[50px] bg-zinc-950/80 backdrop-blur-md flex items-center justify-between px-3 z-40">
          <div className="flex items-center gap-2 md:hidden">
            <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="aurora-stroke-mobile" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#c084fc" />
                </linearGradient>
                <linearGradient id="aurora-stroke-2-mobile" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#e879f9" />
                </linearGradient>
                <linearGradient id="aurora-stroke-3-mobile" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#c4b5fd" />
                  <stop offset="100%" stopColor="#f0abfc" />
                </linearGradient>
              </defs>
              <path d="M3 17c1.5-2 4-4 6-5s4-1 6 1 4 3 6 2" stroke="url(#aurora-stroke-mobile)" strokeWidth="1.5" opacity="0.9" />
              <path d="M3 13c2-3 5-5 8-4s5 3 8 0" stroke="url(#aurora-stroke-2-mobile)" strokeWidth="1.5" opacity="0.7" />
              <path d="M3 9c2.5-3 6-4 9-2s5 4 8 1" stroke="url(#aurora-stroke-3-mobile)" strokeWidth="1.5" opacity="0.5" />
            </svg>
            <span className="font-semibold text-zinc-100">Aurora</span>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            {!user && (
              <>
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="px-4 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  Log in
                </button>
                <button
                  onClick={() => { setAuthMode('register'); setAuthModalOpen(true); }}
                  className="px-4 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
                >
                  Sign up
                </button>
              </>
            )}
          </div>
        </header>

        {/* Chat messages area */}
        <div 
          ref={scrollRef} 
          className={`flex-1 overflow-y-auto p-4 sm:pt-28 sm:px-6 scroll-smooth ${messages.length === 0 ? 'flex items-center justify-center' : ''}`}
        >
          {messages.length === 0 && (
            <div className="text-center max-w-lg mx-auto py-12">
              <h1 className="text-2xl font-semibold text-white mb-3">What's on your mind today?</h1>
              <p className="text-zinc-500 text-sm mb-6">
                Aurora Gateway - OpenAI-compatible AI API with LM Studio, Ollama support
              </p>
              
              <div className="flex flex-wrap justify-center gap-3">
                <button 
                  onClick={() => setInputValue('Help me brainstorm project ideas')} 
                  className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Brainstorm projects
                </button>
                <button 
                  onClick={() => setInputValue('Explain quantum computing simply')} 
                  className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Explain a concept
                </button>
                <button 
                  onClick={() => setInputValue('Write a poem about the sea')} 
                  className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
                >
                  Creative writing
                </button>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.length > 0 && (
            <div className="space-y-6">
              {messages.map((msg, i) => (
                <div key={msg.id || `msg-${i}`} className={`flex gap-4 max-w-[90%] ${msg.role === 'user' ? 'ml-auto justify-end' : ''}`}>
                  {msg.role !== 'user' && (
                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-white font-bold text-xs">A</span>
                    </div>
                  )}
                  
                  <div className={`relative max-w-[85%] px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-zinc-100 text-zinc-900 rounded-tr-sm' : 'bg-zinc-800/60 border border-zinc-700/40 rounded-tl-sm'}`}>
                    <p className="text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                    {msg.role === 'assistant' && msg.model && (
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-700/40">
                        <span className="text-[10px] text-zinc-500 uppercase">{msg.model}</span>
                      </div>
                    )}

                    <p className="text-[10px] text-zinc-500 mt-2">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}

              {/* Thinking indicator */}
              {isLoading && (
                <div className="flex gap-4 max-w-[90%] ml-auto">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-white font-bold text-xs">A</span>
                  </div>
                  <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce"></span>
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce"></span>
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce"></span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="shrink-0 p-4 sm:p-6 pb-6">
          <form onSubmit={sendMessage} className="max-w-[900px] mx-auto">
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 px-2">
                {files.map((file, i) => (
                  <div key={i} className="relative bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-xs text-zinc-400 flex items-center gap-2">
                    <span>{file.name}</span>
                    <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="hover:text-zinc-200">×</button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative bg-zinc-800/60 border border-zinc-700/40 rounded-2xl shadow-lg focus-within:ring-2 focus-within:ring-indigo-600/30 transition-all flex items-center min-h-[48px]">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                title="Upload files"
              />

              {/* Left controls: + button */}
              <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {/* ChatGPT-style + button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setPlusMenuOpen(!plusMenuOpen); }}
                    className="p-1.5 rounded-lg transition-colors text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  {plusMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setPlusMenuOpen(false)} />
                      <div className="absolute bottom-full left-0 mb-2 bg-zinc-800 border border-zinc-600/60 rounded-xl shadow-2xl z-20 py-1.5 min-w-[180px]">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); fileInputRef.current?.click(); setPlusMenuOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          Upload file
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); fileInputRef.current?.click(); setPlusMenuOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Upload image
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Type your message..."
                className="w-full min-h-[48px] max-h-[180px] pl-[44px] pr-14 py-3 bg-transparent text-zinc-100 placeholder:text-zinc-500 placeholder:truncate resize-none focus:outline-none text-base leading-relaxed transition-opacity"
                rows={1}
                disabled={isLoading}
              />

              {inputValue && (
                <button 
                  type="button" 
                  className="absolute right-12 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
                  onClick={() => setInputValue('')}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}

              <button 
                type="submit" 
                disabled={!inputValue.trim() || isLoading}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all flex items-center justify-center flex-shrink-0 ${!inputValue.trim() || isLoading ? 'text-zinc-600 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}
              >
                {isLoading || isThinking ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                )}
              </button>
            </div>

            <p className="text-center text-[0.675rem] text-zinc-500 mt-3">
              Aurora Gateway • OpenAI-compatible API • Supports LM Studio, Ollama, OpenAI
            </p>
          </form>
        </div>
      </main>

      {/* Mobile navigation bar */}
      <nav className="md:hidden fixed bottom-0 left-[260px] right-0 h-[54px] bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800/40 flex items-center justify-around z-40">
        <button 
          onClick={() => window.history.back()} 
          className="flex flex-col items-center gap-1 px-3 py-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M15 19l-7-7m0 0l7-7m-7 7v13" />
          </svg>
          <span className="text-[10px]">Back</span>
        </button>
        
        <button 
          onClick={() => window.location.reload()} 
          className="flex flex-col items-center gap-1 px-3 py-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span className="text-[10px]">New</span>
        </button>
        
        <button 
          onClick={() => window.location.href = '/settings'} 
          className="flex flex-col items-center gap-1 px-3 py-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[10px]">Settings</span>
        </button>
        
        <button 
          onClick={() => window.location.href = '/library'} 
          className="flex flex-col items-center gap-1 px-3 py-2 text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0a2 2 0 00-2-2M5 11v6m4-6v6m4-6v6m4-6v6" />
          </svg>
          <span className="text-[10px]">Library</span>
        </button>
      </nav>

      {/* Auth Modal Overlay */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setAuthModalOpen(false); setAuthError(''); }}
          />

          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex border-b border-zinc-800/40">
              <button
                onClick={() => { setAuthMode('signin'); setAuthError(''); }}
                className={`flex-1 py-3.5 text-sm font-medium transition-colors relative ${
                  authMode === 'signin' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Sign In
                {authMode === 'signin' && (
                  <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-500 rounded-full" />
                )}
              </button>
              <button
                onClick={() => { setAuthMode('register'); setAuthError(''); }}
                className={`flex-1 py-3.5 text-sm font-medium transition-colors relative ${
                  authMode === 'register' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Create Account
                {authMode === 'register' && (
                  <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-500 rounded-full" />
                )}
              </button>
              <button
                onClick={() => { setAuthModalOpen(false); setAuthError(''); }}
                className="px-4 py-3.5 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="p-6 space-y-4">
              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Email address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label htmlFor="auth-password" className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder={authMode === 'register' ? 'At least 8 characters' : 'Enter your password'}
                  autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                  className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
                />
              </div>

              {authMode === 'register' && (
                <div>
                  <label htmlFor="auth-confirm" className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Confirm password
                  </label>
                  <input
                    id="auth-confirm"
                    type="password"
                    value={authConfirmPassword}
                    onChange={(e) => setAuthConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
                  />
                </div>
              )}

              {authError && (
                <div className="bg-red-950/30 border border-red-900/30 rounded-lg p-3 flex items-start gap-2">
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-red-400">{authError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {authSubmitting ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </>
                ) : authMode === 'signin' ? (
                  'Sign In'
                ) : (
                  'Create Account'
                )}
              </button>
            </form>

            <div className="px-6 pb-5 text-center">
              <p className="text-xs text-zinc-600">
                {authMode === 'signin' ? (
                  <>
                    Don&apos;t have an account?{' '}
                    <button onClick={() => { setAuthMode('register'); setAuthError(''); }} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                      Create one
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button onClick={() => { setAuthMode('signin'); setAuthError(''); }} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Model Selector Overlay */}
      {modelOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setModelOverlayOpen(false); setModelSearch(''); setModelProviderFilter('all'); }}
          />
          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800/40 px-5 py-4 shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-white">Select Model</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">{availableModels.length} models available</p>
              </div>
              <button
                onClick={() => { setModelOverlayOpen(false); setModelSearch(''); setModelProviderFilter('all'); }}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Search bar */}
            <div className="px-5 pt-4 pb-2 shrink-0">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Search models..."
                  autoFocus
                  className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
                />
                {modelSearch && (
                  <button
                    onClick={() => setModelSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            </div>

            {/* Provider filter pills */}
            <div className="px-5 pb-3 shrink-0 flex gap-1.5 overflow-x-auto">
              {(() => {
                const availableSources = new Set(availableModels.map(m => m.source));
                return ['all', 'OpenAI', 'Anthropic', 'DeepSeek', 'Ollama', 'LM Studio'].filter(p => p === 'all' || availableSources.has(p));
              })().map(provider => {
                const isActive = modelProviderFilter === provider;
                const label = provider === 'all' ? 'All' : provider;
                const colorDot = provider === 'OpenAI' ? 'bg-emerald-400'
                  : provider === 'Anthropic' ? 'bg-violet-400'
                  : provider === 'DeepSeek' ? 'bg-teal-400'
                  : provider === 'Ollama' ? 'bg-green-500'
                  : provider === 'LM Studio' ? 'bg-amber-400'
                  : '';
                return (
                  <button
                    key={provider}
                    onClick={() => setModelProviderFilter(provider)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 border border-zinc-700/30'
                    }`}
                  >
                    {colorDot && <span className={`w-1.5 h-1.5 rounded-full ${colorDot}`} />}
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Model list */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {modelsLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <span className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-zinc-500">Loading models...</p>
                </div>
              ) : (() => {
                const filtered = availableModels.filter(m => {
                  const matchesSearch = !modelSearch ||
                    m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
                    (m.name && m.name.toLowerCase().includes(modelSearch.toLowerCase()));
                  const matchesProvider = modelProviderFilter === 'all' || m.source === modelProviderFilter;
                  return matchesSearch && matchesProvider;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <svg className="w-8 h-8 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      <p className="text-sm text-zinc-500">No models found</p>
                      <p className="text-xs text-zinc-600">{modelSearch ? 'Try a different search term' : 'Configure API keys in Settings'}</p>
                      {availableModels.length === 0 && (
                        <a href="/settings" className="mt-2 px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-500 transition-colors">
                          Open Settings
                        </a>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="grid gap-1">
                    {filtered.map(m => {
                      const provider = m.source === 'Ollama' ? 'ollama' : m.source === 'Anthropic' ? 'anthropic' : m.source === 'LM Studio' ? 'lmstudio' : m.source === 'DeepSeek' ? 'deepseek' : 'openai';
                      const isSelected = m.id === model;
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            setModel(m.id);
                            setProviderId(provider);
                            setModelOverlayOpen(false);
                            setModelSearch('');
                            setModelProviderFilter('all');
                          }}
                          className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-colors ${
                            isSelected
                              ? 'bg-indigo-600/10 border border-indigo-500/30'
                              : 'hover:bg-zinc-800/40 border border-transparent'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            m.source === 'OpenAI' ? 'bg-emerald-400' : m.source === 'Anthropic' ? 'bg-violet-400' : m.source === 'DeepSeek' ? 'bg-teal-400' : m.source === 'Ollama' ? 'bg-green-500' : 'bg-amber-400'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${isSelected ? 'text-white font-medium' : 'text-zinc-300'}`}>
                              {m.name || m.id}
                            </p>
                            <p className="text-[11px] text-zinc-500 truncate">{m.id}</p>
                          </div>
                          <span className="text-[10px] text-zinc-600 flex-shrink-0 px-2 py-0.5 rounded-full bg-zinc-800/60">{m.source}</span>
                          {isSelected && (
                            <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* LM Studio Model Limit Overlay — shown at send time when limit exceeded */}
      {lmOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setLmOverlayOpen(false)} />
          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800/40 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Model Limit Reached</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">LM Studio has {lmLoadedModels.length} models loaded &mdash; cannot load &ldquo;{model}&rdquo;</p>
              </div>
              <button onClick={() => setLmOverlayOpen(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-4 space-y-1.5 max-h-[260px] overflow-y-auto">
              <p className="text-[11px] text-zinc-500 mb-2">Unload one of these from LM Studio&rsquo;s GUI, then send your message again:</p>
              {lmLoadedModels.map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    setErrorMessage(`Unload "${m.id}" from LM Studio\u2019s GUI, then try sending again.`);
                    setTimeout(() => setErrorMessage(''), 5000);
                    setLmOverlayOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-left text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors group"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="truncate flex-1">{m.id}</span>
                  <span className="text-[10px] text-zinc-600 group-hover:text-red-400 transition-colors flex-shrink-0">Unload</span>
                </button>
              ))}
            </div>
            <div className="border-t border-zinc-800/40 px-5 py-3">
              <p className="text-[10px] text-zinc-500">After unloading a model, press Send again to load &ldquo;{model}&rdquo;.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}