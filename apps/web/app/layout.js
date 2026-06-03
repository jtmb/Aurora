// @aurora/web - Main Layout Component
// Aurora Chat Gateway - Main application shell with Tailwind "Aurora" theming

import './globals.css';
import { Geist } from 'next/font/google';

const geistSans = Geist({ 
  variable: '--font-geist-sans',
  subsets: ['latin'] 
});

export const metadata = {
  title: 'Aurora - AI Gateway',
  description: 'Multi-model LLM API Gateway with OpenAI-compatible endpoints'
};

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 h-[50px] bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/40 flex items-center justify-between px-3 z-50">
      {/* Left: Logo */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-indigo-600 flex items-center justify-center">
          <span className="text-white font-bold text-xs">A</span>
        </div>
        <span className="font-medium text-zinc-100 hidden sm:block">Aurora</span>
      </div>
      
      {/* Center: Navigation links */}
      <nav className="hidden md:flex items-center gap-3 px-4">
        <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-medium">New Chat</a>
        <a href="/history" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">History</a>
      </nav>
      
      {/* Right: Model selector */}
      <div className="flex items-center gap-2">
        <button className="px-3 py-1.5 bg-zinc-800/60 border border-zinc-700 rounded text-xs text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-1.5">
          Model
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function Sidebar({ isOpen, onClose }) {
  return (
    <aside 
      className={`fixed left-0 top-[50px] bottom-0 w-[260px] bg-zinc-900/95 backdrop-blur-xl border-r border-zinc-800/40 flex flex-col transition-transform duration-300 z-40 ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
    >
      <div className="p-3 border-b border-zinc-800/40">
        <button 
          onClick={onClose}
          className="md:hidden w-full p-2 text-zinc-500 hover:text-zinc-100"
        >
          ← Close Menu
        </button>
      </div>
      
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        <a
          href="/"
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors font-medium
            bg-zinc-800/40 text-zinc-100
          `}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          All Chats
        </a>
      </nav>
      
      <div className="p-3 border-t border-zinc-800/40">
        <button className="w-full px-3 py-2 text-xs text-zinc-500 hover:text-zinc-100 flex items-center gap-2 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>
    </aside>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`font-geist-sans bg-zinc-950 text-zinc-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}