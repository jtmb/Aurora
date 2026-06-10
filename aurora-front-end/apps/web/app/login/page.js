'use client';

// @aurora/web/login — Professional authentication page
// Sign In / Create Account with Aurora dark theme

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('signin'); // 'signin' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsSubmitting(true);

    try {
      const endpoint = mode === 'signin' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Authentication failed. Please try again.');
      }

      if (data.token) {
        localStorage.setItem('auth_token', data.token);
        router.push('/');
      } else {
        throw new Error('No token received from server.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & Tagline */}
        <div className="text-center mb-4 inline-flex items-center gap-3">
          <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <defs>
              <linearGradient id="aurora-login-1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
              <linearGradient id="aurora-login-2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#e879f9" />
              </linearGradient>
              <linearGradient id="aurora-login-3" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#c4b5fd" />
                <stop offset="100%" stopColor="#f0abfc" />
              </linearGradient>
            </defs>
            <path d="M3 17c1.5-2 4-4 6-5s4-1 6 1 4 3 6 2" stroke="url(#aurora-login-1)" strokeWidth="1.5" opacity="0.9" />
            <path d="M3 13c2-3 5-5 8-4s5 3 8 0" stroke="url(#aurora-login-2)" strokeWidth="1.5" opacity="0.7" />
            <path d="M3 9c2.5-3 6-4 9-2s5 4 8 1" stroke="url(#aurora-login-3)" strokeWidth="1.5" opacity="0.5" />
          </svg>
          <h1 className="text-2xl font-bold text-white tracking-tight">Aurora</h1>
          <p className="text-sm text-zinc-500 mt-1">Multi-model LLM API Gateway</p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl overflow-hidden">
          {/* Tab Toggle */}
          <div className="flex border-b border-zinc-800/40">
            <button
              onClick={() => switchMode('signin')}
              className={`flex-1 py-3.5 text-sm font-medium transition-colors relative ${
                mode === 'signin' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Sign In
              {mode === 'signin' && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => switchMode('register')}
              className={`flex-1 py-3.5 text-sm font-medium transition-colors relative ${
                mode === 'register' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Create Account
              {mode === 'register' && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-500 rounded-full" />
              )}
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl pl-4 pr-11 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeWidth={1.8} d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" strokeWidth={1.8} strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password (Register only) */}
            {mode === 'register' && (
              <div>
                <label htmlFor="confirmPassword" className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    className="w-full bg-zinc-800 border border-zinc-700/50 rounded-xl pl-4 pr-11 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30 focus:border-indigo-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeWidth={1.8} d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" strokeWidth={1.8} strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-950/30 border border-red-900/30 rounded-lg p-3 flex items-start gap-2">
                <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing...
                </>
              ) : mode === 'signin' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-600 mt-6">
          {mode === 'signin' ? (
            <>
              Don't have an account?{' '}
              <button onClick={() => switchMode('register')} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => switchMode('signin')} className="text-indigo-400 hover:text-indigo-300 transition-colors">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
