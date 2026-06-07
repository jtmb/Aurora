// @aurora/web - GitPanel component: VS Code-style Source Control panel
// Shows staged/unstaged changes, diff view, commit input, branch management,
// git init, GitHub auth, publish to GitHub, discard changes

'use client';

import { useState, useEffect, useCallback } from 'react';

function getStatusBadge(status) {
  const map = {
    'M': { label: 'M', color: 'text-amber-400' },
    'A': { label: 'A', color: 'text-green-400' },
    'D': { label: 'D', color: 'text-red-400' },
    'R': { label: 'R', color: 'text-purple-400' },
    '?': { label: 'U', color: 'text-emerald-400' },
    ' ': { label: 'S', color: 'text-green-300' },
  };
  return map[status] || { label: status, color: 'text-zinc-400' };
}

function fileStatusLetter(file) {
  if (file.index && file.index !== ' ') return file.index;
  if (file.workingDir && file.workingDir !== ' ') return file.workingDir;
  return ' ';
}

export default function GitPanel({ workspaceId, onFileClick, onRefreshTree }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSections, setExpandedSections] = useState(new Set(['changes', 'staged']));
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [stagingFiles, setStagingFiles] = useState(new Set());
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [branches, setBranches] = useState([]);
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  // New state: init, settings, github auth, publish, discard
  const [initializing, setInitializing] = useState(false);
  const [initResult, setInitResult] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [gitConfig, setGitConfig] = useState({ userName: '', userEmail: '', remoteUrl: '' });
  const [configSaving, setConfigSaving] = useState(false);
  const [githubAuth, setGithubAuth] = useState(null); // { hasToken, username, avatar, name }
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [githubToken, setGithubToken] = useState('');
  const [tokenValidating, setTokenValidating] = useState(false);
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishPrivate, setPublishPrivate] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(null); // file path or null
  const [discarding, setDiscarding] = useState(false);
  const [showSwitchWarning, setShowSwitchWarning] = useState(null); // branch name or null

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/status`);
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setStatus(data);
        setError('');
      }
    } catch {
      // Silently ignore network errors
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/branches`);
      const data = await res.json();
      if (!data.error) setBranches(data.branches || []);
    } catch {
      // Silently ignore — non-git repos return 400
    }
  }, [workspaceId]);

  const fetchGitConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/config`);
      const data = await res.json();
      if (!data.error) setGitConfig(data);
    } catch {}
  }, [workspaceId]);

  const fetchGithubAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/git/github-auth');
      const data = await res.json();
      setGithubAuth(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchBranches();
    fetchGithubAuth();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchBranches, fetchGithubAuth]);

  useEffect(() => {
    if (status?.isGitRepo) {
      fetchGitConfig();
    }
  }, [status?.isGitRepo, fetchGitConfig]);

  const toggleSection = (section) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const handleStageFile = async (filePath) => {
    setStagingFiles(prev => new Set([...prev, filePath]));
    try {
      await fetch(`/api/workspace/${workspaceId}/git/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stage', file: filePath })
      });
      await fetchStatus();
    } catch (err) {
      console.error('Stage error:', err);
    } finally {
      setStagingFiles(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  const handleUnstageFile = async (filePath) => {
    setStagingFiles(prev => new Set([...prev, filePath]));
    try {
      await fetch(`/api/workspace/${workspaceId}/git/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unstage', file: filePath })
      });
      await fetchStatus();
    } catch (err) {
      console.error('Unstage error:', err);
    } finally {
      setStagingFiles(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    setCommitResult(null);
    try {
      const stagedPaths = stagedFiles.map(f => f.path);
      const res = await fetch(`/api/workspace/${workspaceId}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage.trim(), files: stagedPaths })
      });
      const data = await res.json();
      if (data.error) {
        setCommitResult({ type: 'error', message: data.error.message });
      } else {
        setCommitResult({ type: 'success', message: `Committed ${data.commit.hash}` });
        setCommitMessage('');
        await fetchStatus();
        onRefreshTree?.();
      }
    } catch (err) {
      setCommitResult({ type: 'error', message: 'Commit failed: ' + err.message });
    } finally {
      setCommitting(false);
    }
  };

  const handleSwitchBranch = async (branchName) => {
    // Dirty tree safety check
    if (changedCount > 0) {
      setShowSwitchWarning(branchName);
      return;
    }
    await doSwitchBranch(branchName);
  };

  const doSwitchBranch = async (branchName) => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', branchName })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setShowBranchDropdown(false);
        await fetchStatus();
        await fetchBranches();
        fetchGitConfig();
        onRefreshTree?.();
      }
    } catch (err) {
      setError('Failed to switch branch: ' + err.message);
    }
  };

  const handleCreateBranch = async (e) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', newBranchName: newBranchName.trim() })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setNewBranchName('');
        setShowNewBranchInput(false);
        setShowBranchDropdown(false);
        await fetchStatus();
        await fetchBranches();
        onRefreshTree?.();
      }
    } catch (err) {
      setError('Failed to create branch: ' + err.message);
    }
  };

  // --- New handlers: init, config, github auth, publish, discard ---

  const handleInitGit = async () => {
    setInitializing(true);
    setInitResult(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.error) {
        setInitResult({ type: 'error', message: data.error.message });
      } else {
        setInitResult({ type: 'success', message: data.message });
        await fetchStatus();
        await fetchBranches();
        fetchGitConfig();
        onRefreshTree?.();
      }
    } catch (err) {
      setInitResult({ type: 'error', message: 'Init failed: ' + err.message });
    } finally {
      setInitializing(false);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigSaving(true);
    try {
      await fetch(`/api/workspace/${workspaceId}/git/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: gitConfig.userName, userEmail: gitConfig.userEmail })
      });
    } catch {}
    setConfigSaving(false);
  };

  const handleConnectGithub = async (e) => {
    e.preventDefault();
    if (!githubToken.trim()) return;
    setTokenValidating(true);
    try {
      const res = await fetch('/api/git/github-auth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: githubToken.trim() })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error.message);
      } else {
        setGithubAuth({ hasToken: true, username: data.username, avatar: data.avatar, name: data.name });
        setGithubToken('');
        setShowTokenInput(false);
      }
    } catch (err) {
      setError('Failed to connect GitHub: ' + err.message);
    } finally {
      setTokenValidating(false);
    }
  };

  const handleDisconnectGithub = async () => {
    try {
      await fetch('/api/git/github-auth', { method: 'DELETE' });
      setGithubAuth({ hasToken: false, username: null, avatar: null });
    } catch {}
  };

  const handlePublishToGithub = async (e) => {
    e.preventDefault();
    if (!publishName.trim()) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/git/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: publishName.trim(), description: publishDesc.trim(), isPrivate: publishPrivate })
      });
      const data = await res.json();
      if (data.error) {
        setPublishResult({ type: 'error', message: data.error.message });
      } else {
        setPublishResult({ type: 'success', message: `Published to ${data.repoUrl}`, repoUrl: data.repoUrl, pushSuccess: data.pushSuccess });
        setShowPublishForm(false);
        fetchGitConfig();
      }
    } catch (err) {
      setPublishResult({ type: 'error', message: 'Publish failed: ' + err.message });
    } finally {
      setPublishing(false);
    }
  };

  const handleDiscardFile = async (filePath) => {
    setShowDiscardConfirm(filePath);
  };

  const confirmDiscard = async () => {
    if (!showDiscardConfirm) return;
    setDiscarding(true);
    try {
      await fetch(`/api/workspace/${workspaceId}/git/discard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: showDiscardConfirm })
      });
      await fetchStatus();
      onRefreshTree?.();
    } catch (err) {
      setError('Discard failed: ' + err.message);
    } finally {
      setDiscarding(false);
      setShowDiscardConfirm(null);
    }
  };

  // Build staged + unstaged file lists from status
  // A file can appear in BOTH lists if it was staged then modified again
  const stagedFiles = status?.files?.filter(f => {
    const idx = f.index || ' ';
    return idx !== ' ' && idx !== '?';
  }) || [];

  const unstagedFiles = status?.files?.filter(f => {
    const wd = f.workingDir || ' ';
    return wd !== ' ' && wd !== '?';
  }) || [];

  const changedCount = status?.files?.length || 0;

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-zinc-900/80 border-r border-zinc-800/40">
        <div className="flex items-center justify-center flex-1">
          <p className="text-xs text-zinc-600">Loading git status...</p>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex flex-col h-full bg-zinc-900/80 border-r border-zinc-800/40">
        <div className="flex items-center justify-center flex-1 px-4">
          <p className="text-xs text-red-400 text-center">{error}</p>
        </div>
      </div>
    );
  }

  if (!status || !status.isGitRepo) {
    return (
      <div className="flex flex-col h-full bg-zinc-900/80">
        <div className="flex flex-col items-center justify-center flex-1 gap-3 px-5">
          <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
          </svg>
          <p className="text-xs text-zinc-500 text-center">This workspace is not a git repository</p>

          {/* Init result */}
          {initResult && (
            <div className={`w-full max-w-xs px-3 py-2 border rounded text-[10px] text-center ${
              initResult.type === 'success'
                ? 'bg-green-950/30 border-green-900/30 text-green-400'
                : 'bg-red-950/30 border-red-900/30 text-red-400'
            }`}>
              {initResult.message}
            </div>
          )}

          {/* Init button */}
          <button
            onClick={handleInitGit}
            disabled={initializing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {initializing ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Initializing...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Initialize Repository
              </>
            )}
          </button>

          {/* GitHub auth hint */}
          {(!githubAuth || !githubAuth.hasToken) && (
            <div className="mt-2 pt-2 border-t border-zinc-800/40 w-full max-w-xs">
              <p className="text-[10px] text-zinc-600 text-center mb-2">After init, publish to GitHub</p>
              <button
                onClick={() => setShowTokenInput(!showTokenInput)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                Connect GitHub
              </button>
              {showTokenInput && (
                <form onSubmit={handleConnectGithub} className="mt-2 space-y-1.5">
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="ghp_..."
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded px-2 py-1.5 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={!githubToken.trim() || tokenValidating}
                    className="w-full px-3 py-1 rounded text-[10px] font-medium bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-40 transition-colors"
                  >
                    {tokenValidating ? 'Validating...' : 'Save Token'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Connected GitHub info */}
          {githubAuth?.hasToken && (
            <div className="mt-2 pt-2 border-t border-zinc-800/40 w-full max-w-xs">
              <div className="flex items-center gap-2 px-2 py-1.5">
                {githubAuth.avatar && (
                  <img src={githubAuth.avatar} alt="" className="w-5 h-5 rounded-full" />
                )}
                <span className="text-[10px] text-zinc-400">Connected as <span className="text-zinc-300">{githubAuth.username || githubAuth.name}</span></span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const currentBranch = branches.find(b => b.current);
  const hasRemote = gitConfig.remoteUrl && gitConfig.remoteUrl.length > 0;

  return (
    <div className="flex flex-col h-full bg-zinc-900/80">
      {/* Dirty tree switch warning modal */}
      {showSwitchWarning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-5 max-w-sm mx-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-200">Uncommitted Changes</p>
                <p className="text-xs text-zinc-400 mt-1">
                  You have {changedCount} uncommitted change{changedCount !== 1 ? 's' : ''}. Switching to <span className="text-zinc-300 font-mono">{showSwitchWarning}</span> may discard them.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setShowSwitchWarning(null)}
                    className="px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { const b = showSwitchWarning; setShowSwitchWarning(null); doSwitchBranch(b); }}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-500 transition-colors"
                  >
                    Switch Anyway
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Branch header */}
      <div className="px-3 py-2 border-b border-zinc-800/40">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <button
              onClick={() => { setShowBranchDropdown(!showBranchDropdown); if (!showBranchDropdown) fetchBranches(); }}
              className="w-full flex items-center gap-2 text-xs text-zinc-300 hover:text-white transition-colors group"
            >
              <svg className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span className="truncate flex-1 text-left">{status.branch || 'main'}</span>
              <svg className={`w-3 h-3 text-zinc-500 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Branch dropdown */}
            {showBranchDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowBranchDropdown(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                  {branches.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => handleSwitchBranch(b.name)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                        b.current
                          ? 'bg-indigo-600/20 text-indigo-300'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      <span className="truncate">{b.name}</span>
                      {b.current && <span className="text-[9px] text-indigo-400 ml-auto">HEAD</span>}
                    </button>
                  ))}
                  <div className="border-t border-zinc-700/40 mt-0.5 pt-0.5">
                    {showNewBranchInput ? (
                      <form onSubmit={handleCreateBranch} className="flex items-center gap-1 px-2 py-1">
                        <input
                          autoFocus
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCreateBranch(e);
                            } else if (e.key === 'Escape') {
                              setNewBranchName('');
                              setShowNewBranchInput(false);
                            }
                          }}
                          placeholder="Branch name..."
                          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                          onBlur={() => { if (!newBranchName.trim()) setShowNewBranchInput(false); }}
                        />
                        <button type="submit" className="flex-shrink-0 p-1 rounded text-indigo-400 hover:bg-indigo-600/20 transition-colors" title="Create branch">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                      </form>
                    ) : (
                      <button
                        onClick={() => { setShowNewBranchInput(true); setNewBranchName(''); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Create new branch...
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Settings gear & Publish button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors ${showSettings ? 'text-indigo-400 bg-zinc-700/50' : ''}`}
            title="Git settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {!hasRemote && (
            <button
              onClick={() => {
                setShowPublishForm(true);
                setPublishName(publishName || '');
                setPublishDesc('');
                setPublishPrivate(false);
              }}
              className="px-2 py-1 rounded text-[10px] font-medium text-zinc-400 hover:text-white hover:bg-zinc-700/50 transition-colors flex items-center gap-1"
              title="Publish to GitHub"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              Publish
            </button>
          )}
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="mt-2 pt-2 border-t border-zinc-700/40 space-y-2">
            <form onSubmit={handleSaveConfig} className="space-y-1.5">
              <div>
                <label className="text-[9px] text-zinc-500 uppercase tracking-wide">User Name</label>
                <input
                  value={gitConfig.userName}
                  onChange={(e) => setGitConfig(prev => ({ ...prev, userName: e.target.value }))}
                  placeholder="Your Name"
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[9px] text-zinc-500 uppercase tracking-wide">User Email</label>
                <input
                  value={gitConfig.userEmail}
                  onChange={(e) => setGitConfig(prev => ({ ...prev, userEmail: e.target.value }))}
                  placeholder="you@example.com"
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={configSaving}
                className="w-full px-3 py-1 rounded text-[10px] font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
              >
                {configSaving ? 'Saving...' : 'Save Config'}
              </button>
            </form>

            {/* Remote info */}
            {hasRemote && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800/40 rounded text-[10px]">
                <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span className="text-zinc-500 truncate">{gitConfig.remoteUrl}</span>
              </div>
            )}

            {/* GitHub auth section */}
            <div className="border-t border-zinc-700/40 pt-2">
              {!githubAuth?.hasToken ? (
                <div>
                  {showTokenInput ? (
                    <form onSubmit={handleConnectGithub} className="space-y-1.5">
                      <input
                        type="password"
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        placeholder="GitHub Personal Access Token (ghp_...)"
                        className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="submit"
                          disabled={!githubToken.trim() || tokenValidating}
                          className="flex-1 px-3 py-1 rounded text-[10px] font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                        >
                          {tokenValidating ? 'Validating...' : 'Connect'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowTokenInput(false); setGithubToken(''); }}
                          className="px-3 py-1 rounded text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => setShowTokenInput(true)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                      Connect GitHub
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {githubAuth.avatar && (
                      <img src={githubAuth.avatar} alt="" className="w-4 h-4 rounded-full flex-shrink-0" />
                    )}
                    <span className="text-[10px] text-zinc-400 truncate">
                      <span className="text-zinc-300">{githubAuth.username || githubAuth.name}</span>
                    </span>
                  </div>
                  <button
                    onClick={handleDisconnectGithub}
                    className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors px-1"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ahead / Behind indicators */}
        {(status.ahead > 0 || status.behind > 0) && (
          <div className="flex items-center gap-2 mt-1.5 text-[10px]">
            {status.ahead > 0 && (
              <span className="text-sky-400 flex items-center gap-0.5">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M7 17L17 7m0 0H7m10 0v10" />
                </svg>
                {status.ahead} ahead
              </span>
            )}
            {status.behind > 0 && (
              <span className="text-orange-400 flex items-center gap-0.5">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M17 7L7 17m0 0h10m-10 0V7" />
                </svg>
                {status.behind} behind
              </span>
            )}
          </div>
        )}
      </div>

      {/* Publish to GitHub modal */}
      {showPublishForm && (
        <>
          <div className="absolute inset-0 z-20 bg-black/50" onClick={() => setShowPublishForm(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-5 w-80">
            <h3 className="text-sm font-medium text-zinc-200 mb-3">Publish to GitHub</h3>
            <form onSubmit={handlePublishToGithub} className="space-y-3">
              <div>
                <label className="text-[10px] text-zinc-500">Repository name</label>
                <input
                  value={publishName}
                  onChange={(e) => setPublishName(e.target.value)}
                  placeholder="my-repo"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 mt-1"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500">Description (optional)</label>
                <input
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  placeholder="My awesome project"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 mt-1"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={publishPrivate}
                  onChange={(e) => setPublishPrivate(e.target.checked)}
                  className="rounded bg-zinc-900 border-zinc-600 text-indigo-500 focus:ring-indigo-500"
                />
                <span className="text-[10px] text-zinc-400">Private repository</span>
              </label>
              {publishResult?.type === 'error' && (
                <p className="text-[10px] text-red-400">{publishResult.message}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowPublishForm(false)}
                  className="flex-1 px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!publishName.trim() || publishing}
                  className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                >
                  {publishing ? (
                    <>
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Publishing...
                    </>
                  ) : (
                    'Publish'
                  )}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Publish success result */}
      {publishResult?.type === 'success' && (
        <div className="mx-3 mt-2 px-3 py-2 bg-green-950/30 border border-green-900/30 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-[10px] text-green-400 flex-1">
              {publishResult.pushSuccess ? 'Published & pushed' : 'Repo created — push manually'}
            </span>
          </div>
          {publishResult.repoUrl && (
            <a
              href={publishResult.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="block mt-1 text-[10px] text-indigo-400 hover:text-indigo-300 truncate"
            >
              {publishResult.repoUrl}
            </a>
          )}
          <button
            onClick={() => setPublishResult(null)}
            className="mt-1 text-[9px] text-zinc-500 hover:text-zinc-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Commit area (at top, like VS Code) */}
      <div className="flex-shrink-0 border-b border-zinc-800/40 p-3 bg-zinc-900">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder={`Message${changedCount > 0 ? ` (${changedCount} change${changedCount !== 1 ? 's' : ''})` : ''}`}
          rows={3}
          className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-zinc-600">
            {status?.staged?.length > 0
              ? `${status.staged.length} staged`
              : 'Stage files to commit'}
          </span>
          <button
            onClick={handleCommit}
            disabled={committing || !commitMessage.trim()}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
          >
            {committing ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Committing{stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ''}...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Commit{stagedFiles.length > 0 ? ` (${stagedFiles.length})` : ''}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scrollable file list area */}
      <div className="flex-1 overflow-y-auto">
        {/* Error banner */}
        {error && (
          <div className="mx-3 mt-2 px-2 py-1.5 bg-red-950/30 border border-red-900/30 rounded text-[10px] text-red-400">
            {error}
          </div>
        )}

        {/* Commit result */}
        {commitResult && (
          <div className={`mx-3 mt-2 px-2 py-1.5 border rounded text-[10px] ${
            commitResult.type === 'success'
              ? 'bg-green-950/30 border-green-900/30 text-green-400'
              : 'bg-red-950/30 border-red-900/30 text-red-400'
          }`}>
            {commitResult.message}
          </div>
        )}

        {/* Staged Changes section */}
        <div className="mt-1">
          <button
            onClick={() => toggleSection('staged')}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wide hover:text-zinc-300 transition-colors"
          >
            <svg className={`w-3 h-3 transition-transform ${expandedSections.has('staged') ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Staged Changes
            <span className="ml-auto text-xs font-normal text-zinc-600">{stagedFiles.length}</span>
          </button>
          {expandedSections.has('staged') && (
            <div>
              {stagedFiles.length === 0 ? (
                <p className="px-3 py-2 text-[10px] text-zinc-600">No staged changes</p>
              ) : (
                stagedFiles.map((f) => {
                  const badge = getStatusBadge(f.index || ' ');
                  return (
                    <div
                      key={`staged-${f.path}`}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800/50 cursor-pointer group"
                      onClick={() => onFileClick?.(f.path, true)}
                    >
                      <span className={`w-4 text-center font-mono text-[10px] ${badge.color}`}>{badge.label}</span>
                      <span className="truncate flex-1">{f.path}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleUnstageFile(f.path); }}
                        disabled={stagingFiles.has(f.path)}
                        className="p-0.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                        title="Unstage"
                      >
                        {stagingFiles.has(f.path) ? (
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Changes section (unstaged) */}
        <div>
          <button
            onClick={() => toggleSection('changes')}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wide hover:text-zinc-300 transition-colors"
          >
            <svg className={`w-3 h-3 transition-transform ${expandedSections.has('changes') ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Changes
            <span className="ml-auto text-xs font-normal text-zinc-600">{unstagedFiles.length}</span>
          </button>
          {expandedSections.has('changes') && (
            <div>
              {unstagedFiles.length === 0 ? (
                <p className="px-3 py-2 text-[10px] text-zinc-600">No changes</p>
              ) : (
                unstagedFiles.map((f) => {
                  const letter = fileStatusLetter(f);
                  const badge = getStatusBadge(letter);
                  return (
                    <div
                      key={`unstaged-${f.path}`}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800/50 cursor-pointer group"
                      onClick={() => onFileClick?.(f.path, false)}
                    >
                      <span className={`w-4 text-center font-mono text-[10px] ${badge.color}`}>{badge.label}</span>
                      <span className="truncate flex-1">{f.path}</span>
                      {/* Discard button */}
                      {showDiscardConfirm === f.path ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[9px] text-zinc-400">Discard?</span>
                          <button
                            onClick={confirmDiscard}
                            disabled={discarding}
                            className="text-[9px] text-red-400 hover:text-red-300 px-1"
                          >
                            {discarding ? '...' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setShowDiscardConfirm(null)}
                            className="text-[9px] text-zinc-500 hover:text-zinc-400 px-1"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDiscardFile(f.path); }}
                          className="p-0.5 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-700/50 opacity-0 group-hover:opacity-100 transition-all"
                          title="Discard changes"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                          </svg>
                        </button>
                      )}
                      {/* Stage button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStageFile(f.path); }}
                        disabled={stagingFiles.has(f.path)}
                        className="p-0.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                        title="Stage"
                      >
                        {stagingFiles.has(f.path) ? (
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
