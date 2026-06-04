// @aurora/web - Root Layout
// Minimal shell: provides HTML structure with dark mode theme

import './globals.css';

export const metadata = {
  title: 'Aurora - AI Gateway',
  description: 'Multi-model LLM API Gateway with OpenAI-compatible endpoints'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}