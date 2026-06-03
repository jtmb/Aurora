// @aurora/web - Main Layout Component
// Aurora Chat Gateway - Main application shell with Tailwind "Aurora" theming

import './globals.css';
import { Geist, JetBrains_Mono } from 'next/font/google';

const geistSans = Geist({ 
  variable: '--font-geist-sans',
  subsets: ['latin'] 
});

const jetBrainsMono = JetBrains_Mono({ 
  variable: '--font-jetbrains-mono', 
  subsets: ['latin'] 
});

export const metadata = {
  title: 'Aurora - AI Gateway',
  description: 'Multi-model LLM API Gateway with OpenAI-compatible endpoints'
};

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/40 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <span className="font-semibold text-zinc-100">Aurora</span>
      </div>
      
      <nav className="hidden md:flex items-center gap-6 text-sm">
        <a href="/" className="text-zinc-500 hover:text-zinc-100 transition-colors">Chat</a>
        <a href="/history" className="text-zinc-500 hover:text-zinc-100 transition-colors">History</a>
        <a href="/settings" className="text-zinc-500 hover:text-zinc-100 transition-colors">Settings</a>
      </nav>
      
      <div className="flex items-center gap-4">
        {typeof window !== 'undefined' && typeof document?.cookie === 'string' ? (
          <>
            {document.cookie.includes('logged_in') && (
              <button 
                onClick={() => logout()}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Logout
              </button>
            )}
          </>
        ) : (
          <button 
            onClick={() => {
              document.cookie = 'logged_in=true';
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            Login (demo)
          </button>
        )}
      </div>
    </header>
  );
}

function Sidebar({ isOpen, onClose }) {
  const historyItems = [
    { id: 'all', label: 'All Chats' },
    { id: 'saved', label: 'Saved Prompts' },
  ];
  
  return (
    <aside 
      className={`fixed left-0 top-14 bottom-0 w-[260px] bg-zinc-900/50 backdrop-blur-xl border-r border-zinc-800/40 transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
    >
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-zinc-800/40">
          <button 
            onClick={onClose}
            className="md:hidden w-full p-2 text-zinc-500 hover:text-zinc-100"
          >
            ← Close Menu
          </button>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-3">
          {historyItems.map((item) => (
            <a
              key={item.id}
              href={`/${item.id}`}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                ${item.id === 'all' ? 'bg-zinc-800/40 text-zinc-100' : 'text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/20'}
              `}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {item.id === 'all' ? (
                  <path strokeLinecap="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                ) : (
                  <path strokeLinecap="round" strokeWidth={1.5} d="M8 21h8a2 2 0 002-2V9m-4 0V3m4 0V3m-4 0a2 2 0 114 0 2 2 0 01-4 0z" />
                )}
              </svg>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        
        <div className="p-4 border-t border-zinc-800/40">
          <button className="w-full px-3 py-2 text-sm text-zinc-500 hover:text-zinc-100 flex items-center gap-2 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
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