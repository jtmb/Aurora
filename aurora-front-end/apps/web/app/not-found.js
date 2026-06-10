// 404 Not Found page
export default function NotFound() {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl font-bold text-zinc-700 mb-4">404</div>
          <h1 className="text-xl font-semibold text-white mb-2">Page not found</h1>
          <p className="text-sm text-zinc-500 mb-6">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <a
            href="/"
            className="inline-block px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition-colors"
          >
            Go home
          </a>
        </div>
      </body>
    </html>
  );
}
