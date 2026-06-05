// @aurora/web - Main Chat Page with streaming, thinking process, and vision support
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Home() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [hydrated, setHydrated] = useState(false); // prevents Sign In flash before auth check
  const [providerId, setProviderId] = useState('openai');
  const [thoughtProcess, setThoughtProcess] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const thinkingContainerRef = useRef(null);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [chatList, setChatList] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [chatWebSearch, setChatWebSearch] = useState({}); // per-chat web search state
  const [expandedThinkingIds, setExpandedThinkingIds] = useState(new Set());
  const [deleteConfirmChat, setDeleteConfirmChat] = useState(null);
  const [personalities, setPersonalities] = useState([]);
  const [activePersonalityId, setActivePersonalityId] = useState(null);
  const [modelOverlayTab, setModelOverlayTab] = useState('models');
  const [newPersonalityName, setNewPersonalityName] = useState('');
  const [newPersonalityPrompt, setNewPersonalityPrompt] = useState('');
  const [editingPersonalityId, setEditingPersonalityId] = useState(null);
  const [searchPendingQuery, setSearchPendingQuery] = useState('');
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatePromptDesc, setGeneratePromptDesc] = useState('');
  const [showGenerateField, setShowGenerateField] = useState(false);
  const [linkPreviews, setLinkPreviews] = useState({}); // { [url]: { title, description, image, favicon, domain, loading } }
  const scrollRef = useRef(null);
  const plusMenuRef = useRef(null);

  // Provider icons for model selector — size variant
  const providerIcons = (source, size = 'w-3.5 h-3.5') => {
    const cls = `${size} flex-shrink-0`;
    switch (source) {
      case 'OpenAI': return <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 4.5c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6-2.7-6-6-6zm-11 0c-3.3 0-6 2.7-6 6s2.7 6 6 6c1.4 0 2.7-.5 3.8-1.3-.9-1.4-1.4-3-1.4-4.7s.5-3.3 1.4-4.7c-1.1-.8-2.4-1.3-3.8-1.3z"/></svg>;
      case 'Anthropic': return <svg className={cls} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>;
      case 'DeepSeek': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/></svg>;
      case 'Ollama': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z"/></svg>;
      case 'LM Studio': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round"/><path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4"/></svg>;
      default: return <span className={`${size} rounded-full bg-zinc-600`} />;
    }
  };

  // Persist model selection to localStorage for restoration across refreshes
  useEffect(() => {
    if (model) {
      localStorage.setItem('aurora_last_model', model);
      localStorage.setItem('aurora_last_provider', providerId);
    }
  }, [model, providerId]);

  // Load personalities and chat web search state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('aurora_personalities');
      let loaded = [];
      if (saved) {
        loaded = JSON.parse(saved);
      }
      // Always ensure the default Aurora personality exists
      const hasAuroraDefault = loaded.some(p => p.id === 'pers_aurora_default');
      if (!hasAuroraDefault) {
        const auroraDefault = {
          id: 'pers_aurora_default',
          name: 'Aurora',
          prompt: 'You are Aurora, a friendly and helpful AI assistant created to brighten people\'s day. You are female, warm, kind, and always eager to help with anything you\'re asked. You know yourself as Aurora — that is your name and identity, and you never refer to yourself by any other name. You speak with a gentle, encouraging tone and genuinely care about making every interaction pleasant, supportive, and productive. You are curious, thoughtful, and approachable — like a trusted friend who also happens to be highly knowledgeable. You have the ability to search the web for current, real-time information when the user enables the web search feature — if a question would benefit from up-to-date information, you can suggest turning on web search to get the latest data. When you don\'t know something or your knowledge may be outdated, you\'re honest about it and offer to look it up. Your goal is to make people feel heard, understood, and empowered.',
          isDefault: true,
          createdAt: new Date().toISOString()
        };
        loaded = [auroraDefault, ...loaded];
      }
      setPersonalities(loaded);
      localStorage.setItem('aurora_personalities', JSON.stringify(loaded));

      const active = localStorage.getItem('aurora_active_personality');
      if (active) {
        const activeId = JSON.parse(active);
        // If the active personality no longer exists, fall back to Aurora default
        if (loaded.some(p => p.id === activeId)) {
          setActivePersonalityId(activeId);
        } else {
          setActivePersonalityId('pers_aurora_default');
          localStorage.setItem('aurora_active_personality', JSON.stringify('pers_aurora_default'));
        }
      } else if (!active && loaded.length > 0) {
        // No active personality set yet — default to Aurora
        setActivePersonalityId('pers_aurora_default');
        localStorage.setItem('aurora_active_personality', JSON.stringify('pers_aurora_default'));
      }
      const searchState = localStorage.getItem('aurora_chat_search');
      if (searchState) setChatWebSearch(JSON.parse(searchState));
    } catch {}
  }, []);

  // Persist personalities to localStorage
  useEffect(() => {
    if (personalities.length > 0) {
      localStorage.setItem('aurora_personalities', JSON.stringify(personalities));
    } else {
      localStorage.removeItem('aurora_personalities');
    }
  }, [personalities]);

  // Persist active personality
  useEffect(() => {
    if (activePersonalityId) {
      localStorage.setItem('aurora_active_personality', JSON.stringify(activePersonalityId));
    } else {
      localStorage.removeItem('aurora_active_personality');
    }
  }, [activePersonalityId]);

  // Sync webSearchEnabled when chat changes
  useEffect(() => {
    if (currentChatId) {
      setWebSearchEnabled(!!chatWebSearch[currentChatId]);
    } else {
      setWebSearchEnabled(false);
    }
  }, [currentChatId, chatWebSearch]);

  // Persist chat web search state
  useEffect(() => {
    if (Object.keys(chatWebSearch).length > 0) {
      localStorage.setItem('aurora_chat_search', JSON.stringify(chatWebSearch));
    } else {
      localStorage.removeItem('aurora_chat_search');
    }
  }, [chatWebSearch]);

  // Handle "search the web" suggestion — enable search and resend
  const acceptSearchSuggestion = (msgId, pendingQuery) => {
    // Toggle search on for this chat
    setWebSearchEnabled(true);
    if (currentChatId) {
      setChatWebSearch(cw => ({ ...cw, [currentChatId]: true }));
    }
    // Remove the suggestion bubble
    setMessages(prev => prev.filter(m => m.id !== msgId));
    // Re-trigger send with the original query
    setInputValue(pendingQuery);
    setTimeout(() => {
      setInputValue(pendingQuery);
      // Trigger send via a synthetic submit on next tick
      const form = document.querySelector('form');
      if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, 50);
  };

  // Dismiss search suggestion
  const dismissSearchSuggestion = (msgId) => {
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  // Generate a system prompt using AI based on a description
  const generatePrompt = async () => {
    if (!generatePromptDesc.trim() || generatingPrompt) return;
    setGeneratingPrompt(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
      const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
      let lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      const lmStudioHost = localStorage.getItem('LM_STUDIO_HOST');
      const lmStudioPort = localStorage.getItem('LM_STUDIO_PORT');
      const lmStudioApiKey = localStorage.getItem('LM_STUDIO_API_KEY');
      
      // Construct LM Studio URL from host+port if URL isn't directly stored
      if (!lmStudioUrl && lmStudioHost && lmStudioPort) {
        lmStudioUrl = `http://${lmStudioHost}:${lmStudioPort}/v1`;
      }
      
      if (openaiKey) headers['x-openai-key'] = openaiKey;
      if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
      if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
      if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
      if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
      if (lmStudioHost) headers['x-lmstudio-host'] = lmStudioHost;
      if (lmStudioPort) headers['x-lmstudio-port'] = lmStudioPort;
      if (lmStudioApiKey) headers['x-lmstudio-api-key'] = lmStudioApiKey;

      const res = await fetch('/api/personality/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ description: generatePromptDesc.trim() })
      });
      const data = await res.json();
      if (data.prompt) {
        setNewPersonalityPrompt(data.prompt);
        if (data.name && !newPersonalityName.trim()) {
          setNewPersonalityName(data.name);
        }
        setShowGenerateField(false);
        setGeneratePromptDesc('');
      } else {
        console.error('[Generate] Failed:', data.error);
      }
    } catch (err) {
      console.error('[Generate] Error:', err.message);
    } finally {
      setGeneratingPrompt(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isThinking]);

  // Auto-scroll thinking container to bottom when new thinking chunks arrive during streaming
  useEffect(() => {
    if (isLoading && thinkingContainerRef.current) {
      thinkingContainerRef.current.scrollTop = thinkingContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-collapse thinking when streaming finishes
  useEffect(() => {
    if (!isLoading) {
      setExpandedThinkingIds(new Set());
    }
  }, [isLoading]);

  // Fetch link previews for assistant messages that have URLs
  useEffect(() => {
    const fetchPreviews = async () => {
      const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
      const assistantMessages = messages.filter(m => m.role === 'assistant' && m.content);
      const urlsToFetch = [];

      for (const msg of assistantMessages) {
        let match;
        while ((match = linkRegex.exec(msg.content)) !== null) {
          const url = match[2];
          if (!linkPreviews[url] && !urlsToFetch.some(u => u.url === url)) {
            urlsToFetch.push({ url, msgId: msg.id });
          }
        }
      }

      if (urlsToFetch.length === 0) return;

      // Mark all as loading
      setLinkPreviews(prev => {
        const next = { ...prev };
        for (const { url } of urlsToFetch) {
          if (!next[url]) next[url] = { loading: true };
        }
        return next;
      });

      // Fetch previews in parallel (max 5 concurrent)
      const batchSize = 5;
      for (let i = 0; i < urlsToFetch.length; i += batchSize) {
        const batch = urlsToFetch.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(({ url }) =>
            fetch(`/api/link-preview?url=${encodeURIComponent(url)}`).then(r => r.ok ? r.json() : null)
          )
        );
        setLinkPreviews(prev => {
          const next = { ...prev };
          batch.forEach(({ url }, idx) => {
            const data = results[idx].status === 'fulfilled' ? results[idx].value : null;
            next[url] = {
              loading: false,
              title: data?.title || null,
              description: data?.description || null,
              image: data?.image || null,
              favicon: data?.favicon || null,
              domain: data?.domain || null,
              error: !data
            };
          });
          return next;
        });
      }
    };

    fetchPreviews();
  }, [messages]);

  // Initialize app: check auth and load models on mount
  useEffect(() => {
    const init = async () => {
      await checkAuth();
      setModelsLoading(false);
      setHydrated(true);
    };
    init();
  }, []);

  // Hydrate localStorage with provider keys from server (SQLite) on login.
  // Only fills missing keys — localStorage is canonical, server is backup.
  const hydrateKeysFromServer = async (token) => {
    try {
      const res = await fetch('/api/auth/keys', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const keys = data.keys || [];
      // Only restore keys from the server (SQLite) if available.
      // localStorage values take priority for fields not returned by the server.
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
      let lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      const lmStudioHost = localStorage.getItem('LM_STUDIO_HOST');
      const lmStudioPort = localStorage.getItem('LM_STUDIO_PORT');
      const lmStudioApiKeyB = localStorage.getItem('LM_STUDIO_API_KEY');
      
      // Construct LM Studio URL from host+port if URL isn't directly stored
      if (!lmStudioUrl && lmStudioHost && lmStudioPort) {
        lmStudioUrl = `http://${lmStudioHost}:${lmStudioPort}/v1`;
      }
      
      if (openaiKey) headers['x-openai-key'] = openaiKey;
      if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
      if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
      if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
      if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
      if (lmStudioHost) headers['x-lmstudio-host'] = lmStudioHost;
      if (lmStudioPort) headers['x-lmstudio-port'] = lmStudioPort;
      if (lmStudioApiKeyB) headers['x-lmstudio-api-key'] = lmStudioApiKeyB;

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
            // Restore last-used model from localStorage, or fall back to first available
            const savedModel = localStorage.getItem('aurora_last_model');
            const savedProvider = localStorage.getItem('aurora_last_provider');
            const foundModel = savedModel && modelsData.models.find(m => m.id === savedModel);
            if (foundModel) {
              setModel(foundModel.id);
              setProviderId(foundModel.source === 'Ollama' ? 'ollama' 
                : foundModel.source === 'Anthropic' ? 'anthropic' 
                : foundModel.source === 'LM Studio' ? 'lmstudio'
                : foundModel.source === 'DeepSeek' ? 'deepseek'
                : 'openai');
            } else {
              const defaultModel = modelsData.models[0];
              setModel(defaultModel.id);
              setProviderId(
                defaultModel.source === 'Ollama' ? 'ollama' 
                : defaultModel.source === 'Anthropic' ? 'anthropic' 
                : defaultModel.source === 'LM Studio' ? 'lmstudio'
                : defaultModel.source === 'DeepSeek' ? 'deepseek'
                : 'openai'
              );
            }
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
        // Hydrate localStorage with provider keys from server (SQLite)
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
        let lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
        const lmStudioHost = localStorage.getItem('LM_STUDIO_HOST');
        const lmStudioPort = localStorage.getItem('LM_STUDIO_PORT');
        const lmStudioApiKeyC = localStorage.getItem('LM_STUDIO_API_KEY');
        
        // Construct LM Studio URL from host+port if URL isn't directly stored
        if (!lmStudioUrl && lmStudioHost && lmStudioPort) {
          lmStudioUrl = `http://${lmStudioHost}:${lmStudioPort}/v1`;
        }
        
        if (openaiKey) headers['x-openai-key'] = openaiKey;
        if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
        if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
        if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
        if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
        if (lmStudioHost) headers['x-lmstudio-host'] = lmStudioHost;
        if (lmStudioPort) headers['x-lmstudio-port'] = lmStudioPort;
        if (lmStudioApiKeyC) headers['x-lmstudio-api-key'] = lmStudioApiKeyC;
        try {
          const res = await fetch('/api/providers/models', { headers });
          if (res.ok) {
            const data = await res.json();
            if (data.models?.length > 0) {
              setAvailableModels(data.models);
              const savedModel = localStorage.getItem('aurora_last_model');
              const foundRetry = savedModel && data.models.find(m => m.id === savedModel);
              setModel(foundRetry ? foundRetry.id : data.models[0].id);
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
    setWebSearchEnabled(false);
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
        const cleanedMessages = (data.messages || []).map(m => ({
          ...m,
          content: m.role === 'assistant' ? cleanMarkdownLinks(m.content) : m.content
        }));
        setMessages(cleanedMessages);
        // Restore model/provider from the chat, with fallback if unavailable
        if (data.modelId) {
          const modelExists = availableModels.some(m => m.id === data.modelId);
          if (modelExists) {
            setModel(data.modelId);
            if (data.provider) setProviderId(data.provider);
          } else if (data.provider) {
            // Fallback: find any model from the same provider
            const providerFallback = availableModels.find(m => {
              const src = m.source.toLowerCase();
              return src === data.provider;
            });
            if (providerFallback) {
              setModel(providerFallback.id);
              setProviderId(data.provider);
            } else if (availableModels.length > 0) {
              setModel(availableModels[0].id);
              setProviderId('openai');
            }
          } else if (availableModels.length > 0) {
            setModel(availableModels[0].id);
          }
        } else if (data.provider) {
          setProviderId(data.provider);
        }
      }
    } catch (e) {
      console.debug('Open chat error:', e.message);
    }
  };

  // Stop the current response
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  };

  // Copy message content
  const handleCopy = (content) => {
    navigator.clipboard.writeText(content).catch(() => {});
  };

  // Clean parenthesized URLs that LLMs often produce: (https://example.com) → [domain.com](https://example.com)
  // Uses negative lookbehind (?<!\]) to avoid double-converting already-valid [text](url) markdown links.
  // Also moves trailing sentence punctuation (.!?;) from after a URL to before the link,
  // so periods don't appear on a new line after block embed cards.
  // Applied at data-ingestion time so ReactMarkdown always receives clean markdown.
  const cleanMarkdownLinks = (text) => {
    if (!text) return text;
    // Pass 1: Convert parenthesized bare URLs to markdown links
    text = text.replace(/(?<!\])(\((https?:\/\/[^\s<>"']+?)\))/g, (match, _outer, url) => {
      try {
        const safeUrl = url.replace(/[)]/g, '');
        if (!safeUrl) return match;
        const domain = new URL(safeUrl).hostname.replace('www.', '');
        return '[' + domain + '](' + safeUrl + ')';
      } catch { return match; }
    });
    // Pass 2: Move trailing sentence punctuation before markdown links
    //          [text](url).  →  .[text](url)   so the period stays with the sentence
    text = text.replace(/(\[.*?\]\(https?:\/\/[^\s<>"')]+?\))([.!?;]+)/g, '$2$1');
    // Pass 3: Handle bare URLs with trailing punctuation that weren't caught by pass 1
    text = text.replace(/(https?:\/\/[^\s<>"')]+?)([.!?;]+)(\s|$)/g, (_match, url, punct, space) => {
      try {
        const domain = new URL(url).hostname.replace('www.', '');
        return punct + ' [' + domain + '](' + url + ')' + space;
      } catch { return _match; }
    });
    return text;
  };

  // Get dynamic thinking label based on content
  const getThinkingLabel = (thinking, streaming) => {
    if (!streaming) return <>Done <span className="text-green-400">✓</span></>;
    const t = (thinking || '').toLowerCase();
    if (/\b(?:analyz|break\s*down|examin|inspect|dissect|scrutiniz)\b/i.test(t)) return 'Analyzing';
    if (/\b(?:reason|think|logic|deduc|infer|conclude|ponder)\b/i.test(t)) return 'Reasoning';
    if (/\b(?:evaluat|assess|weigh|judge|compar|decide)\b/i.test(t)) return 'Evaluating';
    if (/\b(?:plan|outline|step|approach|strateg|organiz)\b/i.test(t)) return 'Planning';
    if (/\b(?:calculat|comput|math|equation|formula|arithmetic)\b/i.test(t)) return 'Calculating';
    if (/\b(?:process|working|generating|producing|crafting|building)\b/i.test(t)) return 'Processing';
    if (/\b(?:verif|check|confirm|validat|test|ensur)\b/i.test(t)) return 'Verifying';
    if (/\b(?:summariz|recap|sum\s*up|overview|condens)\b/i.test(t)) return 'Summarizing';
    if (/\b(?:refin|improv|polish|enhance|tweak|adjust)\b/i.test(t)) return 'Refining';
    return 'Thinking';
  };

  // Resend / regenerate: remove last assistant message and re-send the last user message
  const handleResend = () => {
    if (isLoading) return;
    const msgs = [...messages];
    // Find the last user message
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const lastUserMsg = msgs[lastUserIdx];
    // Remove everything from the last user message onward
    const trimmed = msgs.slice(0, lastUserIdx);
    setMessages(trimmed);
    // Re-send that user's content
    setInputValue(lastUserMsg.content);
    setTimeout(() => {
      const form = document.querySelector('form');
      if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, 50);
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    if (!user) {
      setAuthModalOpen(true);
      return;
    }

    // Search intent detection: if user types "search the web" without search enabled
    const searchPatterns = /\b(search the web|search online|search for|look up|google|web search|find online|do a search|search the internet)\b/i;
    if (!webSearchEnabled && searchPatterns.test(inputValue.trim())) {
      const pendingQuery = inputValue;
      setInputValue('');
      setMessages(prev => [...prev, {
        id: `search_suggest_${Date.now()}`,
        role: 'assistant',
        content: `I noticed you asked me to **"search the web"** but web search isn't enabled for this chat. Would you like me to enable it and search for you?`,
        isSearchSuggestion: true,
        pendingQuery
      }]);
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
    setStreamStarted(false);

    // Auto-create a chat if none is active
    let chatId = currentChatId;
    if (!chatId) {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          const chatRes = await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: inputValue.slice(0, 60), model, provider: providerId })
          });
          if (chatRes.ok) {
            const chatData = await chatRes.json();
            chatId = chatData.id;
            // Preserve web search state for the new chat before setting currentChatId
            if (webSearchEnabled) {
              setChatWebSearch(cw => ({ ...cw, [chatId]: true }));
            }
            setCurrentChatId(chatId);
            loadChats();
          }
        }
      } catch {}
    }

    // Persist user message and update model for this chat
    if (chatId) {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          await fetch(`/api/chats/${chatId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content: inputValue, model, provider: providerId })
          });
          // Update the chat's model if it changed
          await fetch(`/api/chats/${chatId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId: model, provider: providerId })
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

      // Fetch web search results (if enabled)
      let searchBlock = '';
      let searchSourcesCache = null;
      if (webSearchEnabled) {
        try {
          const searchQuery = encodeURIComponent(inputValue.trim().slice(0, 200));
          const searchRes = await fetch(`/api/web-search?q=${searchQuery}`);
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            // Store search result URLs for embedding
            const searchSources = [];
            searchBlock = `\n\n[WEB SEARCH RESULTS — These are your PRIMARY and ONLY source of current information. You MUST cite sources by including the URL in parentheses after any fact you use, like this: "Raccoons are omnivorous (https://example.com/raccoons)." Every factual claim MUST have a citation URL. Do NOT say "search results show" or "according to the search" — just state the facts with URLs. If you can't find the answer in these results, say so honestly.]\n`;
            if (searchData.abstract?.text) {
              searchBlock += `\nAbstract: ${searchData.abstract.text}\nSource: ${searchData.abstract.url}\n`;
              if (searchData.abstract.url) searchSources.push({ title: searchData.abstract.text.slice(0, 80), url: searchData.abstract.url });
            }
            if (searchData.results?.length) {
              searchBlock += '\nResults:\n';
              searchData.results.forEach((r, i) => {
                searchBlock += `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}\n`;
                if (r.url) searchSources.push({ title: r.title?.slice(0, 80) || r.snippet?.slice(0, 80) || '', url: r.url });
              });
            }
            searchBlock += '\n[End of web search results]';
            // Save sources for later use
            if (searchSources.length > 0) {
              searchSourcesCache = searchSources;
            }
          }
        } catch (err) {
          console.error('[Web Search] Failed:', err.message);
        }
      }

      // Build system prompt: search results FIRST, then personality
      const personality = activePersonalityId
        ? personalities.find(p => p.id === activePersonalityId)
        : null;
      const personalityPrompt = personality?.prompt || '';

      if (searchBlock || personalityPrompt) {
        // Remove any pre-existing system messages from history to avoid duplication
        messagesArray = messagesArray.filter(m => m.role !== 'system');
        
        const systemContent = [
          searchBlock,
          searchBlock && personalityPrompt ? '\n\n---\n\n[Your personality / behavior instructions]\n' + personalityPrompt : '',
          !searchBlock && personalityPrompt ? personalityPrompt : '',
          !searchBlock && !personalityPrompt ? '' : ''
        ].filter(Boolean).join('');

        if (systemContent) {
          messagesArray.unshift({ role: 'system', content: systemContent });
        }
      }

      // Build headers with API keys from localStorage
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('auth_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      const deepseekKey = localStorage.getItem('DEEPSEEK_API_KEY');
      const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
      let lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      const lmStudioHost = localStorage.getItem('LM_STUDIO_HOST');
      const lmStudioPort = localStorage.getItem('LM_STUDIO_PORT');
      const lmStudioApiKeyD = localStorage.getItem('LM_STUDIO_API_KEY');
      
      // Construct LM Studio URL from host+port if URL isn't directly stored
      if (!lmStudioUrl && lmStudioHost && lmStudioPort) {
        lmStudioUrl = `http://${lmStudioHost}:${lmStudioPort}/v1`;
      }
      
      if (openaiKey) headers['x-openai-key'] = openaiKey;
      if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
      if (deepseekKey) headers['x-deepseek-key'] = deepseekKey;
      if (ollamaBase) headers['x-ollama-base'] = ollamaBase;
      if (lmStudioUrl) headers['x-lmstudio-url'] = lmStudioUrl;
      if (lmStudioHost) headers['x-lmstudio-host'] = lmStudioHost;
      if (lmStudioPort) headers['x-lmstudio-port'] = lmStudioPort;
      if (lmStudioApiKeyD) headers['x-lmstudio-api-key'] = lmStudioApiKeyD;
      
      // Create abort controller for stop functionality
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: messagesArray,
          temperature: 0.7,
          top_p: 1,
          max_tokens: null,
          provider: providerId,
          stream: true
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Failed to get response from ${model}`);
      }

      // Read SSE stream for real-time thinking + content
      const assistantId = (Date.now() + 1).toString();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = '';
      let streamedContent = '';
      let streamedThinking = '';
      let messageCreated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamBuffer += decoder.decode(value, { stream: true });
        
        // Parse SSE lines
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const delta = data.choices?.[0]?.delta;
            if (!delta) continue;

            // Capture thinking/reasoning as it streams
            const think = delta.thinking || delta.reasoning_content || delta.reasoning || '';
            if (think) {
              streamedThinking += think;
            }

            // Capture content as it streams
            const contentChunk = delta.content || '';
            if (contentChunk) {
              streamedContent += contentChunk;
            }

            // Create or update the assistant message
            if (!messageCreated) {
              messageCreated = true;
              setStreamStarted(true);
              setMessages(prev => [...prev, {
                id: assistantId,
                role: 'assistant',
                content: cleanMarkdownLinks(streamedContent),
                thinking: streamedThinking || undefined,
                timestamp: new Date().toISOString(),
                model: data.model || model,
                provider: providerId,
                searchSources: searchSourcesCache || undefined
              }]);
            } else {
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: cleanMarkdownLinks(streamedContent), thinking: streamedThinking || m.thinking }
                  : m
              ));
            }
          } catch {}
        }
      }

      // Final content check (in case last chunk wasn't processed above)
      const finalContent = streamedContent;
      const finalThinking = streamedThinking;

      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: cleanMarkdownLinks(finalContent), thinking: finalThinking || undefined, searchSources: searchSourcesCache || m.searchSources }
          : m
      ));

      // Persist assistant message to chat — use FINAL cleaned content
      const cleanedFinal = cleanMarkdownLinks(finalContent);
      if (chatId && cleanedFinal) {
        try {
          const token = localStorage.getItem('auth_token');
          if (token) {
            await fetch(`/api/chats/${chatId}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'assistant', content: cleanedFinal, model, provider: providerId })
            });
          }
        } catch {}
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Chat request aborted by user');
        // Keep any partial content that may have been streamed
      } else {
        console.error('Chat error:', error.message);
        setErrorMessage(error.message);
        setTimeout(() => setErrorMessage(''), 5000);
      }
    } finally {
      setIsLoading(false);
      setStreamStarted(false);
      abortControllerRef.current = null;

      // Smart search tip: detect if the LLM indicated it can't search or has outdated data
      if (!webSearchEnabled) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant' || last.isSearchSuggestion) return prev;
          const content = (last.content || '').toLowerCase();
          const patterns = [
            /(?:don'?t|do not)\s+have\s+(?:access\s+to\s+)?(?:real[ -]?time|current|live|the\s+internet|web)/i,
            /(?:my|the)\s+(?:knowledge|training)\s+(?:cutoff|data|only\s+goes|is\s+limited)/i,
            /(?:i\s+)?can'?t\s+(?:browse|search|access|look\s+up)\s+(?:the\s+)?(?:web|internet|online)/i,
            /(?:as\s+of|before|prior\s+to)\s+(?:my|the)\s+(?:knowledge|training|last\s+update)/i,
            /(?:i|my\s+responses?)\s+(?:am|is|are)\s+(?:limited|restricted)\s+to\s+(?:my\s+)?(?:knowledge|training|local)/i,
            /outdated.*(?:information|data|knowledge)|(?:information|data|knowledge).*outdated/i,
            /unable\s+to\s+(?:provide|give|offer)\s+(?:current|real[ -]?time|up[ -]to[ -]?date|live)/i,
            /don'?t\s+have\s+(?:internet|web)\s+access/i,
            /(?:my|the)\s+(?:responses?|answers?)\s+(?:may|might|could)\s+be\s+(?:outdated|inaccurate)/i,
            /(?:i|we)\s+(?:would|could)\s+need\s+(?:to\s+)?search/i,
            /(?:if\s+you|please)\s+(?:enable|turn\s+on|activate)\s+(?:web\s+)?search/i,
          ];
          if (patterns.some(p => p.test(content))) {
            return prev.map(m => m.id === last.id ? { ...m, showSearchTip: true } : m);
          }
          return prev;
        });
      }
    }
  };

  const abortControllerRef = useRef(null);
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

  // Close plus menu on click outside (mousedown listener avoids CSS transform stacking context issues)
  useEffect(() => {
    if (!plusMenuOpen) return;
    const handler = (e) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target)) {
        setPlusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [plusMenuOpen]);

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
    localStorage.removeItem('aurora_last_model');
    localStorage.removeItem('aurora_last_provider');
    setUser(null);
    setMessages([]);
    setCurrentChatId(null);
    setChatList([]);
    setAvailableModels([]);
    setModel('');
    setWebSearchEnabled(false);
    setChatWebSearch({});
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
        // Restore provider keys from server (SQLite) and load models
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
              <div className="flex-1 text-left min-w-0">
                <span className="truncate block text-zinc-300">{modelsLoading ? 'Loading...' : (model || 'Select a model')}</span>
                {activePersonalityId && (() => {
                  const p = personalities.find(x => x.id === activePersonalityId);
                  return p ? <span className="text-[10px] text-indigo-400/70 truncate block">{p.name}</span> : null;
                })()}
              </div>
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
                      className={`w-full flex items-center gap-3 pl-4 pr-14 py-[calc(0.75rem+6px)] rounded-lg text-sm text-left transition-colors ${
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
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-zinc-900/90 backdrop-blur-sm rounded-lg px-1 py-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingChatId(chat.id); setRenameValue(chat.title || ''); }}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
                        title="Rename"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmChat(chat); }}
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
          {!hydrated ? (
            <div className="flex items-center gap-3 px-2 py-2 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-zinc-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-28 bg-zinc-800 rounded" />
                <div className="h-2.5 w-14 bg-zinc-800 rounded" />
              </div>
            </div>
          ) : !user ? (
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
              {messages.map((msg, i) => {
                const isThinkingExpanded = expandedThinkingIds.has(msg.id);
                const toggleThinking = () => {
                  setExpandedThinkingIds(prev => {
                    const next = new Set(prev);
                    if (next.has(msg.id)) next.delete(msg.id);
                    else next.add(msg.id);
                    return next;
                  });
                };

                return (
                <div key={msg.id || `msg-${i}`} className={`flex gap-4 max-w-[90%] ${msg.role === 'user' ? 'ml-auto justify-end' : ''}`}>
                  {/* Search suggestion bubble */}
                  {msg.isSearchSuggestion ? (
                    <>
                      <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700/50 flex items-center justify-center flex-shrink-0 mt-1 overflow-hidden">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <defs>
                            <linearGradient id="aurora-avatar-search" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="#818cf8" />
                              <stop offset="100%" stopColor="#c084fc" />
                            </linearGradient>
                          </defs>
                          <path d="M3 17c1.5-2 4-4 6-5s4-1 6 1 4 3 6 2" stroke="url(#aurora-avatar-search)" strokeWidth="1.5" opacity="0.9" />
                          <path d="M3 13c2-3 5-5 8-4s5 3 8 0" stroke="url(#aurora-avatar-search)" strokeWidth="1.5" opacity="0.5" />
                          <path d="M3 9c2.5-3 6-4 9-2s5 4 8 1" stroke="url(#aurora-avatar-search)" strokeWidth="1.5" opacity="0.3" />
                        </svg>
                      </div>
                      <div className="bg-zinc-800/60 border border-indigo-600/30 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                        <div className="text-sm text-zinc-200 leading-relaxed prose prose-invert prose-zinc max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => acceptSearchSuggestion(msg.id, msg.pendingQuery)}
                            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 transition-colors flex items-center gap-1.5"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                            </svg>
                            Yes, search the web
                          </button>
                          <button
                            type="button"
                            onClick={() => dismissSearchSuggestion(msg.id)}
                            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40 rounded-lg transition-colors"
                          >
                            No thanks
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                  <>
                  {msg.role !== 'user' && (
                    <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700/50 flex items-center justify-center flex-shrink-0 mt-1 overflow-hidden">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <defs>
                          <linearGradient id={`aurora-avatar-${msg.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#818cf8" />
                            <stop offset="100%" stopColor="#c084fc" />
                          </linearGradient>
                        </defs>
                        <path d="M3 17c1.5-2 4-4 6-5s4-1 6 1 4 3 6 2" stroke={`url(#aurora-avatar-${msg.id})`} strokeWidth="1.5" opacity="0.9" />
                        <path d="M3 13c2-3 5-5 8-4s5 3 8 0" stroke={`url(#aurora-avatar-${msg.id})`} strokeWidth="1.5" opacity="0.5" />
                        <path d="M3 9c2.5-3 6-4 9-2s5 4 8 1" stroke={`url(#aurora-avatar-${msg.id})`} strokeWidth="1.5" opacity="0.3" />
                      </svg>
                    </div>
                  )}
                  
                  <div className={`relative max-w-[85%] px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-[#1d6fc9] text-white rounded-tr-sm' : 'bg-zinc-800/60 border border-zinc-700/40 rounded-tl-sm'}`}>
                    {/* Thinking / Reasoning display */}
                    {msg.role === 'assistant' && msg.thinking && (() => {
                      const isStreaming = i === messages.length - 1 && isLoading;
                      return (
                      <div className="mb-3">
                        <button
                          type="button"
                          onClick={toggleThinking}
                          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors w-full text-left"
                        >
                          <svg className={`w-3 h-3 transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span>{getThinkingLabel(msg.thinking, isStreaming)}</span>
                          {isStreaming && (
                            <span className="animate-thinking-dots">
                              <span>.</span><span>.</span><span>.</span>
                            </span>
                          )}
                        </button>
                        {isThinkingExpanded && (
                          isStreaming ? (
                            <div className="mt-2 pl-4 border-l-2 border-zinc-600/50 relative">
                              {/* Top scroll fade — hides scrolled-out text */}
                              <div className="absolute top-0 left-4 right-0 h-8 bg-gradient-to-b from-zinc-800/60 via-zinc-800/30 to-transparent z-10 pointer-events-none" />
                              <div
                                ref={thinkingContainerRef}
                                className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-[6rem] overflow-y-auto"
                                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                              >
                                {msg.thinking}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 pl-4 border-l-2 border-zinc-600/50 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                              {msg.thinking}
                            </div>
                          )
                        )}
                      </div>
                      );
                    })()}

                    <div className="text-base leading-relaxed prose prose-invert prose-zinc max-w-none prose-code:bg-zinc-700/50 prose-code:text-zinc-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-700/40 prose-pre:rounded-xl prose-pre:text-sm prose-headings:text-zinc-100 prose-a:text-indigo-400 prose-strong:text-zinc-100 prose-li:marker:text-zinc-500">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={msg.role === 'assistant' ? {
                          a: ({ href, children }) => {
                            // Safety: if href is missing or invalid, render as plain text
                            if (!href) return <span>{children}</span>;
                            const preview = linkPreviews[href];
                            const hasPreview = preview && !preview.loading && !preview.error && (preview.title || preview.description);
                            let domain = '';
                            try { domain = new URL(href).hostname.replace('www.', ''); } catch { return <span>{children || href}</span>; }

                            // Rich block-level preview card — displayed as a standalone block in the message
                            if (hasPreview) {
                              return (
                                <span className="block my-2">
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block rounded-lg bg-zinc-800/80 border border-zinc-700/50 hover:border-indigo-500/30 hover:bg-zinc-800 transition-colors no-underline overflow-hidden max-w-sm"
                                  >
                                  {preview.image && (
                                    <span className="block w-full h-16 bg-zinc-700/50 overflow-hidden">
                                      <img src={preview.image} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                                    </span>
                                  )}
                                  <span className="flex items-center gap-2 px-2.5 py-2">
                                    {!preview.image && (
                                      <span className="flex-shrink-0 w-5 h-5 rounded bg-zinc-700/50 overflow-hidden flex items-center justify-center">
                                        {preview.favicon ? (
                                          <img src={preview.favicon} alt="" className="w-3.5 h-3.5 rounded" loading="lazy" referrerPolicy="no-referrer" />
                                        ) : (
                                          <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                          </svg>
                                        )}
                                      </span>
                                    )}
                                    <span className="min-w-0 flex-1">
                                      <span className="text-[11px] font-semibold text-zinc-200 leading-tight line-clamp-1 block">
                                        {preview.title || domain}
                                      </span>
                                      {preview.description && (
                                        <span className="text-[10px] text-zinc-400 mt-0.5 leading-tight line-clamp-1 block">
                                          {preview.description}
                                        </span>
                                      )}
                                      <span className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-1">
                                        {preview.favicon && <img src={preview.favicon} alt="" className="w-3 h-3 rounded" loading="lazy" referrerPolicy="no-referrer" />}
                                        {domain}
                                      </span>
                                    </span>
                                  </span>
                                </a>
                                </span>
                              );
                            }

                            // Simple link chip — for links without preview data
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] no-underline bg-indigo-600/10 border border-indigo-500/20 text-indigo-300 hover:bg-indigo-600/20 hover:text-indigo-200 transition-colors align-baseline"
                              >
                                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                <span>{domain || children}</span>
                              </a>
                            );
                          }
                        } : undefined}
                      >
                        {(msg.content || '')}
                      </ReactMarkdown>
                    </div>


                    {msg.role === 'assistant' && msg.model && (
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-700/40">
                        <span className="text-[10px] text-zinc-500 uppercase">{msg.model}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <p className={`text-[10px] ${msg.role === 'user' ? 'text-white/50' : 'text-zinc-500'}`}>{new Date(msg.timestamp).toLocaleTimeString()}</p>
                      <div className="flex items-center gap-0.5">
                        {/* Copy button — only on assistant messages, not loading, not search suggestion */}
                        {msg.role === 'assistant' && !msg.isSearchSuggestion && msg.content && (
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.content)}
                            title="Copy message"
                            className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                        {/* Regenerate button — only on last assistant message, not loading */}
                        {msg.role === 'assistant' && !msg.isSearchSuggestion && i === messages.length - 1 && !isLoading && (
                          <button
                            type="button"
                            onClick={handleResend}
                            title="Regenerate response"
                            className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  </>
                )}
                </div>
              );
            })}

              {/* Web search discovery tip — shown when LLM indicates it can't search or has outdated data */}
              {!isLoading && !webSearchEnabled && messages.length >= 2 && (() => {
                const lastMsg = messages[messages.length - 1];
                if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.isSearchSuggestion || !lastMsg.showSearchTip) return null;
                const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                if (!lastUserMsg) return null;
                return (
                  <div className="flex gap-4 max-w-[90%]">
                    <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700/50 flex items-center justify-center flex-shrink-0 mt-1 overflow-hidden">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <defs>
                          <linearGradient id="aurora-avatar-tip" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#818cf8" />
                            <stop offset="100%" stopColor="#c084fc" />
                          </linearGradient>
                        </defs>
                        <path d="M3 17c1.5-2 4-4 6-5s4-1 6 1 4 3 6 2" stroke="url(#aurora-avatar-tip)" strokeWidth="1.5" opacity="0.9" />
                        <path d="M3 13c2-3 5-5 8-4s5 3 8 0" stroke="url(#aurora-avatar-tip)" strokeWidth="1.5" opacity="0.5" />
                        <path d="M3 9c2.5-3 6-4 9-2s5 4 8 1" stroke="url(#aurora-avatar-tip)" strokeWidth="1.5" opacity="0.3" />
                      </svg>
                    </div>
                    <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] relative">
                      <button
                        type="button"
                        onClick={() => setMessages(prev => prev.map(m => m.id === lastMsg.id ? { ...m, showSearchTip: undefined } : m))}
                        className="absolute top-2 right-2 p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                        title="Dismiss"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <p className="text-sm text-zinc-300 mb-2 pr-5">
                        <span className="text-indigo-400 font-medium">Did you know</span> you can search the web with Aurora?
                      </p>
                      <p className="text-xs text-zinc-500 mb-3">
                        I can look up current information to give you more accurate, up-to-date answers.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setWebSearchEnabled(true);
                          if (currentChatId) {
                            setChatWebSearch(cw => ({ ...cw, [currentChatId]: true }));
                          }
                          // Dismiss the tip from this message
                          setMessages(prev => prev.map(m => m.id === lastMsg.id ? { ...m, showSearchTip: undefined } : m));
                          // Re-send the last user query with search enabled
                          setInputValue(lastUserMsg.content);
                          setTimeout(() => {
                            const form = document.querySelector('form');
                            if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                          }, 50);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 hover:text-indigo-200 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        Search &quot;{lastUserMsg.content.slice(0, 40)}{lastUserMsg.content.length > 40 ? '...' : ''}&quot;
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Loading indicator */}
              {isLoading && !streamStarted && (
                <div className="flex gap-4 max-w-[90%] ml-auto">
                  <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700/50 flex items-center justify-center flex-shrink-0 mt-1 overflow-hidden">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <defs>
                        <linearGradient id="aurora-avatar-loading" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#818cf8" />
                          <stop offset="100%" stopColor="#c084fc" />
                        </linearGradient>
                      </defs>
                      <path d="M3 17c1.5-2 4-4 6-5s4-1 6 1 4 3 6 2" stroke="url(#aurora-avatar-loading)" strokeWidth="1.5" opacity="0.9" />
                      <path d="M3 13c2-3 5-5 8-4s5 3 8 0" stroke="url(#aurora-avatar-loading)" strokeWidth="1.5" opacity="0.5" />
                      <path d="M3 9c2.5-3 6-4 9-2s5 4 8 1" stroke="url(#aurora-avatar-loading)" strokeWidth="1.5" opacity="0.3" />
                    </svg>
                  </div>
                  <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
                    {webSearchEnabled && (
                      <div className="flex items-center gap-2 mb-3 text-xs text-indigo-300">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        Searching the web...
                      </div>
                    )}
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
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
            {/* Web Search indicator pill */}
            {webSearchEnabled && (
              <div className="flex items-center gap-1.5 mb-2 ml-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600/15 border border-indigo-600/30 rounded-full text-xs text-indigo-300">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  Search
                </span>
                <button type="button" onClick={() => {
                  setWebSearchEnabled(false);
                  if (currentChatId) {
                    setChatWebSearch(cw => ({ ...cw, [currentChatId]: false }));
                  }
                }} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
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
                <div className="relative" ref={plusMenuRef}>
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
                    <div className="absolute bottom-full left-0 mb-2 bg-zinc-800 border border-zinc-600/60 rounded-xl shadow-2xl z-20 py-1.5 min-w-[200px]">
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setWebSearchEnabled(prev => { const next = !prev; if (currentChatId) { setChatWebSearch(cw => ({ ...cw, [currentChatId]: next })); } return next; }); setPlusMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                        Search Web
                        {webSearchEnabled && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
                      </button>
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
                disabled={!isLoading && !inputValue.trim()}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-all flex items-center justify-center flex-shrink-0 ${!isLoading && !inputValue.trim() ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/40'}`}
                onClick={isLoading ? (e) => { e.preventDefault(); handleStop(); } : undefined}
              >
                {isLoading ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : isThinking ? (
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
            className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm"
            onClick={() => { setModelOverlayOpen(false); setModelSearch(''); setModelProviderFilter('all'); setModelOverlayTab('models'); }}
          />
          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800/40 px-5 py-3 shrink-0">
              <div className="flex items-center gap-1 bg-zinc-800/60 rounded-lg p-0.5">
                <button
                  onClick={() => setModelOverlayTab('models')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    modelOverlayTab === 'models'
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Models
                </button>
                <button
                  onClick={() => setModelOverlayTab('personality')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    modelOverlayTab === 'personality'
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Personality
                </button>
              </div>
              <button
                onClick={() => { setModelOverlayOpen(false); setModelSearch(''); setModelProviderFilter('all'); setModelOverlayTab('models'); }}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Models tab content */}
            {modelOverlayTab === 'models' ? (<>
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
                    {provider !== 'all' && <span className="text-current opacity-70">{providerIcons(provider, 'w-3 h-3')}</span>}
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
                            // Persist model change to current chat
                            if (currentChatId) {
                              const token = localStorage.getItem('auth_token');
                              if (token) {
                                fetch(`/api/chats/${currentChatId}`, {
                                  method: 'PATCH',
                                  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ modelId: m.id, provider })
                                }).catch(() => {});
                              }
                            }
                          }}
                          className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-colors ${
                            isSelected
                              ? 'bg-indigo-600/10 border border-indigo-500/30'
                              : 'hover:bg-zinc-800/40 border border-transparent'
                          }`}
                        >
                          <span className={`${
                            m.source === 'OpenAI' ? 'text-emerald-400' : m.source === 'Anthropic' ? 'text-violet-400' : m.source === 'DeepSeek' ? 'text-teal-400' : m.source === 'Ollama' ? 'text-green-400' : 'text-amber-400'
                          }`}>
                            {providerIcons(m.source)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${isSelected ? 'text-white font-medium' : 'text-zinc-300'}`}>
                              {m.name || m.id}
                            </p>
                            <p className="text-[11px] text-zinc-500 truncate">{m.id}</p>
                          </div>
                          <span className="text-[10px] text-zinc-600 flex-shrink-0 px-2 py-0.5 rounded-full bg-zinc-800/60">{m.source}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            </>) : null}

            {/* Personality tab content */}
            {modelOverlayTab === 'personality' && (
            <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col">
              {/* Active personality indicator */}
              {activePersonalityId && (() => {
                const active = personalities.find(p => p.id === activePersonalityId);
                return active ? (
                  <div className="mb-3 px-3 py-2 bg-indigo-600/10 border border-indigo-500/20 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                      <span className="text-xs text-indigo-300 truncate">Active: {active.name}</span>
                    </div>
                    <button
                      onClick={() => setActivePersonalityId(null)}
                      className="text-zinc-500 hover:text-zinc-300 flex-shrink-0 ml-2"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ) : null;
              })()}

              {/* No personality / None option */}
              <button
                onClick={() => {
                  setActivePersonalityId(null);
                  setModelOverlayOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors mb-2 ${
                  !activePersonalityId
                    ? 'bg-zinc-700/40 border border-zinc-600/50'
                    : 'hover:bg-zinc-800/40 border border-transparent'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-zinc-700/60 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!activePersonalityId ? 'text-white font-medium' : 'text-zinc-300'}`}>No personality</p>
                  <p className="text-[11px] text-zinc-500">Use the model&apos;s default behavior</p>
                </div>
                {!activePersonalityId && (
                  <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                )}
              </button>

              {/* Create / Edit form */}
              {editingPersonalityId !== null || (editingPersonalityId === null && !activePersonalityId) ? (
                <div className="mb-3 p-4 bg-zinc-800/40 border border-zinc-700/40 rounded-xl">
                  <p className="text-xs font-medium text-zinc-300 mb-3">
                    {editingPersonalityId ? 'Edit Personality' : 'New Personality'}
                  </p>
                  <input
                    type="text"
                    value={newPersonalityName}
                    onChange={(e) => setNewPersonalityName(e.target.value)}
                    placeholder="Profile name..."
                    className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all mb-2"
                  />
                  <div className="relative">
                    <textarea
                      value={newPersonalityPrompt}
                      onChange={(e) => setNewPersonalityPrompt(e.target.value)}
                      placeholder="System prompt — defines how the AI should behave..."
                      rows={4}
                      className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-2 pr-20 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGenerateField(!showGenerateField)}
                      className={`absolute right-2 top-2 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        showGenerateField
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'bg-zinc-700/60 text-zinc-500 hover:text-indigo-300 hover:bg-zinc-700 border border-zinc-600/30'
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        AI
                      </span>
                    </button>
                  </div>

                  {/* Generate with AI — expandable field */}
                  {showGenerateField && (
                    <div className="mt-2 p-3 bg-indigo-600/5 border border-indigo-500/20 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        <span className="text-[11px] text-indigo-300 font-medium">Describe the personality you want</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={generatePromptDesc}
                          onChange={(e) => setGeneratePromptDesc(e.target.value)}
                          placeholder="e.g. A witty pirate who speaks in nautical slang..."
                          onKeyDown={(e) => { if (e.key === 'Enter') generatePrompt(); }}
                          className="flex-1 bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
                        />
                        <button
                          type="button"
                          onClick={generatePrompt}
                          disabled={!generatePromptDesc.trim() || generatingPrompt}
                          className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 flex-shrink-0"
                        >
                          {generatingPrompt ? (
                            <>
                              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              Generating
                            </>
                          ) : (
                            'Generate'
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => {
                        if (!newPersonalityName.trim() || !newPersonalityPrompt.trim()) return;
                        if (editingPersonalityId && editingPersonalityId !== '__new__') {
                          setPersonalities(prev => prev.map(p => p.id === editingPersonalityId ? { ...p, name: newPersonalityName.trim(), prompt: newPersonalityPrompt.trim() } : p));
                        } else {
                          const newP = { id: `pers_${Date.now()}`, name: newPersonalityName.trim(), prompt: newPersonalityPrompt.trim(), createdAt: new Date().toISOString() };
                          setPersonalities(prev => [newP, ...prev]);
                          setActivePersonalityId(newP.id);
                        }
                        setNewPersonalityName('');
                        setNewPersonalityPrompt('');
                        setEditingPersonalityId(null);
                      }}
                      disabled={!newPersonalityName.trim() || !newPersonalityPrompt.trim()}
                      className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {editingPersonalityId && editingPersonalityId !== '__new__' ? 'Save' : 'Create'}
                    </button>
                    <button
                      onClick={() => { setNewPersonalityName(''); setNewPersonalityPrompt(''); setEditingPersonalityId(null); }}
                      className="px-4 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setEditingPersonalityId('__new__')}
                  className="w-full mb-3 px-4 py-3 border border-dashed border-zinc-700/50 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600/60 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Create New Personality
                </button>
              )}

              {/* Personality list */}
              {personalities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 flex-1">
                  <svg className="w-8 h-8 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  <p className="text-sm text-zinc-500">No personalities yet</p>
                  <p className="text-xs text-zinc-600">Create a personality to give the AI a custom persona</p>
                </div>
              ) : (
                <div className="grid gap-1">
                  {personalities.map(p => {
                    const isActive = p.id === activePersonalityId;
                    return (
                      <div
                        key={p.id}
                        className={`group flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                          isActive
                            ? 'bg-indigo-600/10 border border-indigo-500/30'
                            : 'hover:bg-zinc-800/40 border border-transparent'
                        }`}
                      >
                        <button
                          onClick={() => {
                            setActivePersonalityId(p.id);
                            setModelOverlayOpen(false);
                            setModelSearch('');
                            setModelProviderFilter('all');
                            setModelOverlayTab('models');
                          }}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className={`text-sm truncate ${isActive ? 'text-white font-medium' : 'text-zinc-300'}`}>
                            {p.name}
                            {p.isDefault && (
                              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/20">Default</span>
                            )}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate mt-0.5">{p.prompt.slice(0, 80)}{p.prompt.length > 80 ? '...' : ''}</p>
                        </button>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPersonalityId(p.id);
                              setNewPersonalityName(p.name);
                              setNewPersonalityPrompt(p.prompt);
                            }}
                            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (p.isDefault) return;
                              setPersonalities(prev => prev.filter(x => x.id !== p.id));
                              if (isActive) setActivePersonalityId(null);
                            }}
                            className={`p-1 transition-colors ${p.isDefault ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-500 hover:text-red-400'}`}
                            title={p.isDefault ? 'Default personality cannot be deleted' : 'Delete personality'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Chat Confirmation Modal */}
      {deleteConfirmChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm"
            onClick={() => setDeleteConfirmChat(null)}
          />
          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-5 py-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-zinc-100">Delete Chat</h3>
                  <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
                    This will permanently delete &ldquo;{deleteConfirmChat.title || 'Chat'}&rdquo; and all its messages. This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex border-t border-zinc-800/40">
              <button
                onClick={() => setDeleteConfirmChat(null)}
                className="flex-1 py-3 text-sm font-medium text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const chatToDelete = deleteConfirmChat;
                  setDeleteConfirmChat(null);
                  deleteChat(chatToDelete.id);
                }}
                className="flex-1 py-3 text-sm font-medium text-red-500 hover:text-red-400 hover:bg-red-950/30 transition-colors border-l border-zinc-800/40"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LM Studio Model Limit Overlay — shown at send time when limit exceeded */}
      {lmOverlayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" onClick={() => setLmOverlayOpen(false)} />
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