// @aurora/web - TypingIndicator Component
// Animated bouncing dots to show AI is thinking/responding

export default function TypingIndicator() {
  return (
    <div className="flex gap-4 max-w-[90%]">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-1">
        <span className="text-white font-bold text-xs">A</span>
      </div>

      {/* Bouncing dots */}
      <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1.5 items-center h-5">
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" 
            style={{ animationDelay: '0ms' }} 
          />
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" 
            style={{ animationDelay: '150ms' }} 
          />
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" 
            style={{ animationDelay: '300ms' }} 
          />
        </div>
      </div>
    </div>
  );
}
