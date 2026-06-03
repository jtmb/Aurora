// @aurora/web - Main Chat Page Component
// Aurora Chat Gateway - Full chat interface with message history and input area

'use client';

import { useState } from 'react';

/**
 * Message content component - renders markdown-like text with code blocks
 */
function MessageContent({ content }) {
  if (!content) return null;
  
  // Split by code block delimiters to preserve syntax highlighting
  const parts = content.split(/(`{2,}[\s\S]*?`{2,})/g);
  
  return (
    <div className="message-content text-lg leading-relaxed whitespace-pre-wrap">
      {parts.map((part, index) => {
        // Check if this is a code block
        if (part.startsWith('```')) {
          const [lang, ...codeRest] = part.split('\n', 2);
          const language = lang.replace('```', '').trim() || 'text';
          const code = codeRest.join('\n')?.replace(/^```/, '').replace(/```$/, '') || '';
          
          return (
            <div key={index} className="relative my-4">
              {/* Copy button - appears on hover */}
              <button 
                className="absolute top-2 right-2 p-1.5 rounded-md bg-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => navigator.clipboard.writeText(code)}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              
              {/* Code block */}
              <pre className="bg-[#242427] text-zinc-100 p-3 rounded-lg overflow-x-auto text-sm font-mono border border-zinc-800/40">
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        
        // Regular text - preserve formatting
        return (
          <span key={index} className="whitespace-pre-wrap">
            {part}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Chat message component
 */
function ChatMessage({ role, content, timestamp }) {
  const isUser = role === 'user';
  
  return (
    <article className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-xs">A</span>
          </div>
        </div>
      )}
      
      <div 
        className={`max-w-[85%] px-4 py-3 rounded-2xl ${
          isUser 
            ? 'bg-zinc-100 text-zinc-900 rounded-tr-sm' 
            : 'bg-zinc-900/50 text-zinc-100 rounded-tl-sm border border-zinc-800/40'
        }`}
      >
        <MessageContent content={content} />
        
        {!isUser && timestamp && (
          <span className="text-xs text-zinc-500 mt-2 block">
            {formatTime(timestamp)}
          </span>
        )}
      </div>
      
      {isUser && timestamp && (
        <span className="text-xs text-zinc-500 mb-1 pl-1">
          {formatTime(timestamp)}
        </span>
      )}
    </article>
  );
}

/**
 * Format timestamp to HH:MM AM/PM
 */
function formatTime(date) {
  if (!date) return '';
  
  const d = new Date(date);
  let hour = d.getHours();
  let minute = d.getMinutes().toString().padStart(2, '0');
  
  let period = 'AM';
  if (hour >= 12) {
    period = 'PM';
    hour = hour - 12;
  }
  if (hour === 0) hour = 12;
  
  return `${hour}:${minute} ${period}`;
}

/**
 * Header component with logo and navigation
 */
function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/40 flex items-center justify-between px-6 z-50">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-900/20">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <span className="font-semibold text-zinc-100 tracking-tight">Aurora</span>
      </div>
      
      <nav className="hidden md:flex items-center gap-6 text-sm">
        <a href="/" className="text-zinc-500 hover:text-zinc-100 transition-colors font-medium">Chat</a>
        <a href="/history" className="text-zinc-500 hover:text-zinc-100 transition-colors">History</a>
        <a href="/settings" className="text-zinc-500 hover:text-zinc-100 transition-colors">Settings</a>
      </nav>
      
      <div className="flex items-center gap-3">
        {/* Model selector dropdown */}
        <div className="relative group">
          <button className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-zinc-800/40 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors">
            <span className="text-indigo-400 font-medium">Model</span>
            <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {/* Dropdown menu */}
          <div className="absolute top-full right-0 mt-2 w-64 bg-zinc-900 border border-zinc-800/40 rounded-xl shadow-xl p-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
            <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-800/40 font-medium uppercase tracking-wider">
              Model Selector
            </div>
            <button className="w-full px-3 py-2.5 rounded-lg hover:bg-zinc-800/60 transition-colors text-left flex items-center justify-between group/item">
              <div>
                <span className="text-zinc-100 font-medium block">GPT-4o</span>
                <span className="text-xs text-zinc-500">OpenAI • 128K context</span>
              </div>
              <span className="text-xs bg-indigo-900/30 text-indigo-400 px-2 py-0.5 rounded-full">Recommended</span>
            </button>
            <button className="w-full px-3 py-2.5 rounded-lg hover:bg-zinc-800/60 transition-colors text-left flex items-center justify-between group/item">
              <div>
                <span className="text-zinc-100 font-medium block">Claude 3.5</span>
                <span className="text-xs text-zinc-500">Anthropic • 200K context</span>
              </div>
            </button>
            <button className="w-full px-3 py-2.5 rounded-lg hover:bg-zinc-800/60 transition-colors text-left flex items-center justify-between group/item">
              <div>
                <span className="text-zinc-100 font-medium block">Llama 3.1</span>
                <span className="text-xs text-zinc-500">Ollama • Running locally</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Main chat content component
 */
function ChatContent() {
  const messages = [
    {
      role: 'assistant',
      content: `Hello! I'm Aurora, your AI gateway assistant. I can help you with:\n\n- **Multi-model support**: Access models from OpenAI, Anthropic, Ollama, and LM Studio through a unified interface\n- **OpenAI-compatible API**: All responses follow the standard \`/v1/chat/completions\` format\n- **Secure authentication**: JWT-based auth with OAuth2 support\n- **Usage tracking**: Monitor token usage across all providers\n\nHow can I help you today?`,
      timestamp: new Date(),
    },
  ];

  const [inputValue, setInputValue] = useState('');

  return (
    <main className="flex-1 flex flex-col bg-gradient-to-b from-zinc-950 to-zinc-900">
      {/* Messages area - scrollable */}
      <div 
        id="chat-container"
        className="flex-1 overflow-y-auto p-6 space-y-6"
      >
        {messages.map((msg, index) => (
          <ChatMessage 
            key={index}
            role={msg.role}
            content={msg.content}
            timestamp={msg.timestamp}
          />
        ))}
        
        {/* Scroll to bottom spacer */}
        {messages.length > 0 && (
          <div className="h-4"></div>
        )}
      </div>

      {/* Input area - sticky at bottom */}
      <div className="border-t border-zinc-800/40 bg-zinc-950/80 backdrop-blur-xl p-6 pb-8">
        <div className="max-w-[900px] mx-auto">
          {/* Model selector appears above input */}
          <div className="relative mb-3">
            <button className="w-full pl-4 pr-10 py-2.5 bg-zinc-900/70 border border-zinc-800/40 rounded-xl text-sm text-zinc-300 hover:bg-zinc-800/60 transition-colors flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <span className="text-indigo-400 font-medium">Model:</span>
                <select className="bg-transparent border-none outline-none cursor-pointer text-right">
                  <option value="openai">GPT-4o (OpenAI)</option>
                  <option value="anthropic">Claude 3.5 (Anthropic)</option>
                  <option value="ollama">Llama 3.1 (Ollama)</option>
                  <option value="lmstudio">Mixtral (LM Studio)</option>
                </select>
              </div>
              <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Main input area */}
          <div className="relative bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/40 rounded-2xl shadow-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-600/50 transition-all">
            {/* Attachment button */}
            <button 
              className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-lg transition-colors"
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
              placeholder="Type your message... Press Shift+Enter for new line, Enter to send"
              className="w-full min-h-[56px] max-h-[180px] pl-12 pr-14 py-4 bg-transparent text-zinc-100 placeholder:text-zinc-500 resize-none focus:outline-none text-lg leading-relaxed scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
              rows={1}
            />

            {/* Clear button when input has content */}
            {inputValue && (
              <button 
                className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-lg transition-colors"
                onClick={() => setInputValue('')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}

            {/* Send button */}
            <button 
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all duration-200 flex items-center justify-center
                ${inputValue 
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30' 
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                }`}
              disabled={!inputValue}
            >
              {inputValue ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              ) : (
                <span className="text-xs font-medium">Press Enter to send</span>
              )}
            </button>
          </div>

          {/* Input instructions */}
          <p className="text-center text-xs text-zinc-500 mt-3">
            Aurora Gateway • OpenAI-compatible API • Multi-model support
          </p>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Header />
        <ChatContent />
      </body>
    </html>
  );
}
