// @aurora/web - Main Chat Page Component
// Aurora AI Gateway - Functional ChatGPT-style interface with message streaming

'use client';

import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState('gpt-3.5-turbo');
  const scrollRef = useRef(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

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

    try {
      const response = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_API_KEY || ''}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: inputValue }]
        })
      });

      const data = await response.json();
      
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.choices?.[0]?.message?.content || '',
        timestamp: new Date().toISOString(),
        model: data.model,
        usage: data.usage
      };

      setMessages(prev => [...prev, assistantMessage]);

    } catch (error) {
      console.error('Chat error:', error);
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

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">
      {/* LEFT SIDEBAR */}
      <aside className="w-[260px] flex-shrink-0 flex flex-col border-r border-zinc-800/40 bg-zinc-900 hidden md:flex">
        <div className="flex-1 overflow-y-auto py-3">
          {/* New chat button */}
          <button
            onClick={() => window.location.href = '/new'}
            className={`w-full flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm transition-colors
              ${!inputValue ? 'bg-indigo-600/10 text-white' : 'text-zinc-500 hover:text-zinc-200'}
            `}
          >
            <span className="w-[1.2rem] h-[1.2rem] flex items-center justify-center rounded-full bg-indigo-600/80 shrink-0">
              +
            </span>
            New chat
          </button>

          {/* Divider */}
          <div className="my-2 border-t border-zinc-800/40"></div>

          {/* Recent chats - placeholder list */}
          <nav className="space-y-[calc(0.75rem+3px)]">
            {Array.from({ length: 4 }).map((_, i) => (
              <a
                key={i}
                href={`/chat/${i + 1}`}
                className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors"
              >
                <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm">Project Ideas</p>
                </div>
              </a>
            ))}
          </nav>

          {/* Divider */}
          <div className="my-2 border-t border-zinc-800/40"></div>

          {/* Sidebar actions */}
          <div className="space-y-[calc(0.75rem+3px)]">
            <a href="/settings" className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
              <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </a>

            <a href="/library" className="flex items-center gap-3 px-4 py-[calc(0.75rem+6px)] rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/20 transition-colors">
              <svg className="w-[1.2rem] h-[1.2rem]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.896 4.547 9.504 4.547 8.25 3.25S3.25 4.547 3.25 5.75v13c0 1.196.553 1.749 1.749 1.749H18a2 2 0 002-2V5.75C20 4.547 19.447 4 18.25 3.25A2.002 2.002 0 0016.25 2H9M12 6.253v13m0-13C13.104 4.547 14.496 4.547 15.75 3.25S20.75 4.547 20.75 5.75v13c0 1.196-.553 1.749-1.749 1.749H8a2 2 0 00-2 2V5.75C6 4.547 6.553 4 7.75 3.25A2.002 2.002 0 009.75 2H15" />
              </svg>
              Library
            </a>
          </div>
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
      <main className="flex-1 flex flex-col min-w-0">
        {/* HEADER */}
        <header className="fixed top-0 left-26 right-0 h-[50px] bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/40 flex items-center justify-between px-3 z-40">
          {/* Mobile menu button */}
          <button className="md:hidden p-2 text-zinc-400 hover:text-zinc-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="w-7 h-7 rounded bg-indigo-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-zinc-100">Aurora</span>
          </div>

          {/* Center nav */}
          <nav className="hidden md:flex items-center gap-3 px-4">
            <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-medium">New Chat</a>
            <a href="/history" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">History</a>
          </nav>

          {/* Model selector */}
          <div className="flex items-center gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700 rounded text-xs text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              <option value="gpt-3.5-turbo">GPT-3.5</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="claude-3">Claude 3</option>
              <option value="llama-3">Llama 3</option>
            </select>
          </div>
        </header>

        {/* CHAT AREA */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 pt-[50px] scroll-smooth">
          {messages.length === 0 ? (
            /* Empty state */
            <div className="text-center max-w-lg mx-auto py-12">
              <h1 className="text-2xl font-semibold text-white mb-3">What's on your mind today?</h1>
              <p className="text-zinc-500 text-sm mb-6">Aurora Gateway - OpenAI-compatible AI API</p>
              
              {/* Quick actions */}
              <div className="flex flex-wrap justify-center gap-3">
                <button onClick={() => setInputValue('Help me brainstorm project ideas')} className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Brainstorm projects
                </button>
                <button onClick={() => setInputValue('Explain quantum computing simply')} className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Explain a concept
                </button>
                <button onClick={() => setInputValue('Write a poem about the sea')} className="px-4 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Creative writing
                </button>
              </div>
            </div>
          ) : (
            /* Message list */
            <div className="space-y-6">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-4 max-w-[90%] ${msg.role === 'user' ? 'ml-auto justify-end' : ''}`}
                >
                  {msg.role !== 'user' && (
                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-1">
                      <span className="text-white font-bold text-xs">A</span>
                    </div>
                  )}
                  
                  <div
                    className={`relative max-w-[85%] px-4 py-3 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-zinc-100 text-zinc-900 rounded-tr-sm'
                        : 'bg-zinc-800/60 border border-zinc-700/40 rounded-tl-sm'
                    }`}
                  >
                    <p className="text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    
                    {/* Model badge for assistant */}
                    {msg.role === 'assistant' && (
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-700/40">
                        <span className="text-[10px] text-zinc-500 uppercase">{msg.model}</span>
                        {msg.usage && (
                          <>
                            <span className="text-[10px] text-zinc-600">|</span>
                            <span className="text-[10px] text-zinc-600">{msg.usage?.total_tokens} tokens</span>
                          </>
                        )}
                      </div>
                    )}

                    {/* Timestamp */}
                    <p className="text-[10px] text-zinc-500 mt-2">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex gap-4 max-w-[90%] ml-auto">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-white font-bold text-xs">A</span>
                  </div>
                  <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
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

        {/* INPUT AREA */}
        <div className="shrink-0 p-4 sm:p-6 pb-6">
          <form onSubmit={sendMessage} className="max-w-[900px] mx-auto">
            <div className="relative bg-zinc-800/60 border border-zinc-700/40 rounded-2xl shadow-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-600/30 transition-all flex flex-col">
              {/* Attachment button */}
              <button 
                type="button"
                className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-700/50 transition-colors"
                title="Attach file (coming soon)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>

              {/* Text input */}
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="w-full min-h-[48px] max-h-[180px] pl-14 pr-40 py-3 bg-transparent text-zinc-100 placeholder:text-zinc-500 resize-none focus:outline-none text-base leading-relaxed scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent"
                rows={1}
                disabled={isLoading}
              />

              {/* Clear button */}
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

              {/* Send button */}
              <button 
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all flex items-center justify-center
                  ${!inputValue.trim() || isLoading 
                    ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-500'
                  }`}
              >
                {isLoading ? (
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
              Aurora Gateway • OpenAI-compatible API • Multi-model support
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}