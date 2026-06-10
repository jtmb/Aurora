'use client';

// Error boundary — catches runtime errors in the app and shows a fallback UI
export default function Error({ error, reset }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-900/30 border border-red-700/40 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Something went wrong</h1>
          <p className="text-sm text-zinc-500 mb-6">
            {error?.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <button
            onClick={reset}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
