// @aurora/web - Main Chat Page with streaming, thinking process, and vision support
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export default function Home() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('llama3');
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

  // Check for API keys in localStorage and fetch models if available
  const getModelsFromStorage = async () => {
    setModelsLoading(true);
    try {
      // Build headers with any available API keys from localStorage
      const headers = {};
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
      const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      
      if (openaiKey) headers['x-openai-key'] = openaiKey;
      if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
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
              : 'openai'
            );
            return;
          }
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        console.error('Models API fetch failed:', fetchErr.message);
      }

      // No models found — API route already tries all providers including Ollama
      setAvailableModels([]);

    } catch (error) {
      console.error('Fetch models error:', error.message);
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const checkAuth = async () => {
    const token = localStorage.getItem('auth_token');
    
    if (!token) {
      setUser(null);
    } else {
      setUser({ id: 'demo-user-id', email: 'demo@example.com' });
    }

    try {
      await getModelsFromStorage();
    } catch (modelError) {
      console.debug('Failed to fetch models:', modelError.message);
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
      }
    } catch (e) {
      console.debug('Open chat error:', e.message);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'demo@example.com', password: 'password' })
      });
      
      const data = await res.json();
      
      if (data.token) {
        setUser({ id: 'demo-user-id', email: 'demo@example.com' });
        localStorage.setItem('auth_token', data.token);
        
        await getModelsFromStorage();
      }
    } catch (loginError) {
      console.debug('Login error:', loginError.message);
    }
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!inputValue.trim() || isLoading) return;

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
      const messagesArray = [{ role: 'user', content: inputValue }];
      
      // Build headers with API keys from localStorage
      const headers = { 'Content-Type': 'application/json' };
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      const ollamaBase = localStorage.getItem('OLLAMA_API_BASE');
      const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
      
      if (openaiKey) headers['x-openai-key'] = openaiKey;
      if (anthropicKey) headers['x-anthropic-key'] = anthropicKey;
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

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const [files, setFiles] = useState([]);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside className={`w-[260px] flex-shrink-0 flex flex-col border-r border-zinc-800/40 bg-zinc-900 hidden md:flex`}>
        <div className="flex-1 overflow-y-auto py-3">
          <button 
            onClick={newChat} 
            className={`w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm transition-colors bg-indigo-600/10 text-white hover:bg-indigo-600/20`}
          >
            <span className="w-[1.2rem] h-[1.2rem] flex items-center justify-center rounded-full bg-indigo-600/80 shrink-0">+</span>
            New chat
          </button>

          <div className="my-2 border-t border-zinc-800/40"></div>

          <nav className="space-y-[calc(0.75rem+3px)]">
            {chatList.length === 0 ? (
              <p className="px-4 py-2 text-xs text-zinc-600">No chats yet. Start a conversation!</p>
            ) : (
              chatList.map((chat) => (
                <button
                  key={chat.id}
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
              ))
            )}
          </nav>

          <div className="my-2 border-t border-zinc-800/40"></div>

          <div className="space-y-[calc(0.75rem+3px)]">
            <a href="/settings" className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
              Settings
            </a>
            <a href="/library" className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
              Library
            </a>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800/40">
          {!user ? (
            <button 
              onClick={handleLogin}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition-colors"
            >
              Sign in with demo credentials
            </button>
          ) : (
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-zinc-800/50">
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-medium">
                {user.name?.[0] || user.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                <p className="text-xs text-zinc-500">Free Plan</p>
              </div>
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
        <header className="fixed top-0 left-26 right-0 h-[50px] bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/40 flex items-center justify-between px-3 z-40">
          <div className="flex items-center gap-2 md:hidden">
            <div className="w-7 h-7 rounded bg-indigo-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-zinc-100">Aurora</span>
          </div>

          <div className="flex items-center gap-2 flex-1 md:flex-[2]">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isLoading}
              className={`flex-1 px-3 py-1.5 rounded text-xs border transition-colors cursor-pointer max-w-full disabled:cursor-not-allowed disabled:opacity-50 ${
                availableModels.find(m => m.id === model)?.source === 'OpenAI' 
                  ? 'bg-green-900/20 border-green-700/40 text-green-200' 
                  : availableModels.find(m => m.id === model)?.source === 'Anthropic'
                    ? 'bg-purple-900/20 border-purple-700/40 text-purple-200'
                    : availableModels.find(m => m.id === model)?.source === 'Ollama'
                      ? 'bg-green-800/40 border-green-600/40 text-green-200'
                      : 'bg-orange-900/20 border-orange-700/40 text-orange-200'
              }`}>
              {modelsLoading ? (
                <option value="">Loading models...</option>
              ) : availableModels.length === 0 ? (
                <option value="">No models — check Settings</option>
              ) : (
                availableModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))
              )}
            </select>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700 rounded text-xs text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama</option>
              <option value="lmstudio">LM Studio</option>
            </select>
          </div>
        </header>

        {/* Chat messages area */}
        <div 
          ref={scrollRef} 
          className={`flex-1 overflow-y-auto p-4 sm:p-6 pt-[50px] scroll-smooth ${messages.length === 0 && !user ? 'flex items-center justify-center' : ''}`}
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
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-4 max-w-[90%] ${msg.role === 'user' ? 'ml-auto justify-end' : ''}`}>
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

            <div className="relative bg-zinc-800/60 border border-zinc-700/40 rounded-2xl shadow-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-600/30 transition-all flex flex-col">
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                title="Upload files (vision support coming soon)"
              />
              
              <button 
                type="button" 
                className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-700/50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>

              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className={`w-full min-h-[48px] max-h-[180px] pl-14 pr-40 py-3 bg-transparent text-zinc-100 placeholder:text-zinc-500 resize-none focus:outline-none text-base leading-relaxed scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent transition-opacity ${
                  !user || isLoading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                rows={1}
                disabled={!user || isLoading}
              />

              {inputValue && (
                <button 
                  type="button" 
                  className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-700/50 transition-colors"
                  onClick={() => setInputValue('')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}

              <button 
                type="submit" 
                disabled={!inputValue.trim() || isLoading || !user}
                className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all flex items-center justify-center ${!inputValue.trim() || isLoading || !user ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}
              >
                {isLoading || isThinking ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                ) : inputValue.trim() ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                ) : (
                  <span className="text-xs">Press Enter to send</span>
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
    </div>
  );
}