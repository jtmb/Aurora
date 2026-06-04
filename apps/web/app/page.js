// @aurora/web - Main Chat Page with streaming, thinking process, and vision support
'use client';

import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('llama3');
  const [availableModels, setAvailableModels] = useState([]);
  const [user, setUser] = useState(null);
  const [providerId, setProviderId] = useState('openai');
  const [thoughtProcess, setThoughtProcess] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isThinking]);

  // Check for API keys in localStorage and fetch models if available
  const getModelsFromStorage = async () => {
    try {
      const openaiKey = localStorage.getItem('OPENAI_API_KEY');
      const anthropicKey = localStorage.getItem('ANTHROPIC_API_KEY');
      
      // Only fetch models if at least one API key is configured
      if (openaiKey || anthropicKey) {
        const modelsRes = await fetch('/api/providers/models', {
          headers: {} // Models endpoint doesn't need auth for discovery
        });
        
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          setAvailableModels(modelsData.models || []);
          
          // Set default model from available models
          if (modelsData.models.length > 0 && !model.includes('/')) {
            for (const source of ['OpenAI', 'Ollama', 'Anthropic']) {
              const openaiModel = modelsData.models.find(m => m.source === source);
              if (openaiModel) {
                setModel(openaiModel.id);
                break;
              }
            }
          }
        }
      } else {
        // No API keys - fetch Ollama/LM Studio default models based on configuration
        try {
          // Get LM Studio URL from localStorage (e.g., http://192.168.0.13:1234)
          const lmStudioUrl = localStorage.getItem('LM_STUDIO_URL');
          
          if (lmStudioUrl) {
            // Try custom LM Studio URL first
            const modelsRes = await fetch(`${lmStudioUrl}/v1/tags`);
            if (modelsRes.ok) {
              const data = await modelsRes.json();
              const availableModelsArr = Array.isArray(data.models) ? data.models : [];
              setAvailableModels(availableModelsArr);
              if (availableModelsArr.length > 0 && !model.includes('/')) {
                setModel(availableModelsArr[0]?.name || 'llama3');
              }
            }
          } else {
            // Fallback to localhost Ollama
            const ollamaBase = localStorage.getItem('OLLAMA_API_BASE') || 'http://localhost:11434';
            const modelsRes = await fetch(`${ollamaBase}/tags`);
            if (modelsRes.ok) {
              const data = await modelsRes.json();
              const availableModelsArr = Array.isArray(data.models) ? data.models : [];
              setAvailableModels(availableModelsArr);
              if (availableModelsArr.length > 0 && !model.includes('/')) {
                setModel(availableModelsArr[0]?.name || 'llama3');
              }
            }
          }
        } catch (e) {
          console.debug('Failed to fetch default models:', e.message);
        }
      }
    } catch (error) {
      console.debug('Fetch models error:', error.message);
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
    if (!inputValue.trim() || isLoading || !availableModels.length) return;

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

    try {
      const messagesArray = [{ role: 'user', content: inputValue }];
      
      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: messagesArray,
          temperature: 0.7,
          top_p: 1,
          max_tokens: null
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

    } catch (error) {
      console.error('Chat error:', error.message);
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
            onClick={() => { setMessages([]); setInputValue(''); }} 
            className={`w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm transition-colors ${!inputValue ? 'bg-indigo-600/10 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <span className="w-[1.2rem] h-[1.2rem] flex items-center justify-center rounded-full bg-indigo-600/80 shrink-0">+</span>
            New chat
          </button>

          <div className="my-2 border-t border-zinc-800/40"></div>

          <nav className="space-y-[calc(0.75rem+3px)]">
            {Array.from({ length: 4 }).map((_, i) => (
              <a 
                key={i} 
                href={`/chat/${i + 1}`} 
                className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors"
              >
                <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm">Project Ideas</p>
                </div>
              </a>
            ))}
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
              onClick={() => window.location.href = '/api/auth/login'} 
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
              disabled={!availableModels.length}
              className={`flex-1 px-3 py-1.5 rounded text-xs border transition-colors cursor-pointer max-w-full disabled:cursor-not-allowed disabled:opacity-50 ${
                availableModels.find(m => m.id === model)?.source === 'OpenAI' 
                  ? 'bg-green-900/20 border-green-700/40 text-green-200' 
                  : availableModels.find(m => m.id === model)?.source === 'Anthropic'
                    ? 'bg-purple-900/20 border-purple-700/40 text-purple-200'
                    : availableModels.find(m => m.id === model)?.source === 'Ollama'
                      ? 'bg-green-800/40 border-green-600/40 text-green-200'
                      : 'bg-orange-900/20 border-orange-700/40 text-orange-200'
              }`}>
              {availableModels.length === 0 && <option value="">Loading models...</option>}
              {availableModels.map(m => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              disabled={!availableModels.length}
              className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700 rounded text-xs text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                  !user || !availableModels.length ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                rows={1}
                disabled={!user || !availableModels.length}
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
                disabled={!inputValue.trim() || isLoading || !user || !availableModels.length}
                className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all flex items-center justify-center ${!inputValue.trim() || isLoading || !user || !availableModels.length ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}
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