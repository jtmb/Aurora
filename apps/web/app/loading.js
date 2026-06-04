// Loading fallback — shown while route segments load
export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" />
          <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" />
          <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce" />
        </div>
      </div>
    </div>
  );
}
