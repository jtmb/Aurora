// @aurora/web/AdminPanel — Admin user management & model access provisioning

'use client';

import { useState, useEffect, useCallback } from 'react';

const PROVIDER_LABELS = {
  openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek',
  ollama: 'Ollama', lmstudio: 'LM Studio',
};

const DEFAULT_PROVIDER_ORDER = ['openai', 'anthropic', 'deepseek', 'ollama', 'lmstudio'];

/**
 * Read API keys from localStorage (mirrors keys used by main chat page & settings)
 */
const getLocalApiKeys = () => {
  if (typeof window === 'undefined') return {};
  return {
    openai: localStorage.getItem('OPENAI_API_KEY') || '',
    anthropic: localStorage.getItem('ANTHROPIC_API_KEY') || '',
    deepseek: localStorage.getItem('DEEPSEEK_API_KEY') || '',
    ollamaBase: localStorage.getItem('OLLAMA_API_BASE') || '',
    lmStudioUrl: localStorage.getItem('LM_STUDIO_URL') || '',
    lmStudioHost: localStorage.getItem('LM_STUDIO_HOST') || '',
    lmStudioPort: localStorage.getItem('LM_STUDIO_PORT') || '',
    lmStudioApiKey: localStorage.getItem('LM_STUDIO_API_KEY') || '',
  };
};

export default function AdminPanel({ token }) {
  // User list state
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Selected user detail
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserLoading, setSelectedUserLoading] = useState(false);
  const [modelAccess, setModelAccess] = useState({}); // { "provider:modelId": true/false }
  const [modelAccessSaving, setModelAccessSaving] = useState(false);
  const [modelAccessSaveMsg, setModelAccessSaveMsg] = useState('');
  const [accessProviderTab, setAccessProviderTab] = useState('openai');

  // User edit state
  const [editRole, setEditRole] = useState('');
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Reset password state
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwNew, setResetPwNew] = useState('');
  const [resetPwConfirm, setResetPwConfirm] = useState('');
  const [resetPwError, setResetPwError] = useState('');
  const [resetPwSuccess, setResetPwSuccess] = useState('');
  const [resetPwLoading, setResetPwLoading] = useState(false);

  // Create user state
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createName, setCreateName] = useState('');
  const [createRole, setCreateRole] = useState('user');
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Delete confirmation
  const [deleteUserId, setDeleteUserId] = useState(null);

  // Dynamic models from admin's configured providers
  const [availableModels, setAvailableModels] = useState({}); // { provider: [{ id, name }] }
  const [providerOrder, setProviderOrder] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');

  // User usage stats
  const [userUsage, setUserUsage] = useState(null);
  const [userUsageLoading, setUserUsageLoading] = useState(false);

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set('role', roleFilter);
      if (userSearch) params.set('search', userSearch);
      const res = await fetch(`/api/admin/users?${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('[AdminPanel] Failed to fetch users:', err);
    } finally {
      setUsersLoading(false);
    }
  }, [token, roleFilter, userSearch]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Fetch available models from admin's configured providers
  const fetchAvailableModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const localKeys = getLocalApiKeys();
      const fetchHeaders = { ...headers };
      if (localKeys.openai) fetchHeaders['x-openai-key'] = localKeys.openai;
      if (localKeys.anthropic) fetchHeaders['x-anthropic-key'] = localKeys.anthropic;
      if (localKeys.deepseek) fetchHeaders['x-deepseek-key'] = localKeys.deepseek;
      if (localKeys.ollamaBase) fetchHeaders['x-ollama-base'] = localKeys.ollamaBase;
      if (localKeys.lmStudioUrl) fetchHeaders['x-lmstudio-url'] = localKeys.lmStudioUrl;
      if (localKeys.lmStudioHost) fetchHeaders['x-lmstudio-host'] = localKeys.lmStudioHost;
      if (localKeys.lmStudioPort) fetchHeaders['x-lmstudio-port'] = localKeys.lmStudioPort;
      if (localKeys.lmStudioApiKey) fetchHeaders['x-lmstudio-api-key'] = localKeys.lmStudioApiKey;

      const res = await fetch('/api/providers/models', { headers: fetchHeaders });
      if (!res.ok) {
        setModelsError('Failed to load models');
        return;
      }
      const data = await res.json();
      const grouped = {};
      const seenProviders = new Set();
      for (const m of data.models || []) {
        const prov = m.owned_by || m.source?.toLowerCase();
        if (!prov) continue;
        if (!grouped[prov]) grouped[prov] = [];
        // Deduplicate by id
        if (!grouped[prov].find(existing => existing.id === m.id)) {
          grouped[prov].push({ id: m.id, name: m.name || m.id });
        }
        seenProviders.add(prov);
      }
      setAvailableModels(grouped);
      // Build provider order from the data: configured providers first, then fallback to default order
      const order = [];
      for (const p of DEFAULT_PROVIDER_ORDER) {
        if (seenProviders.has(p)) order.push(p);
      }
      setProviderOrder(order);
      // Set default access tab to first available provider
      if (order.length > 0) setAccessProviderTab(order[0]);
    } catch (err) {
      console.error('[AdminPanel] Failed to fetch models:', err);
      setModelsError('Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAvailableModels();
  }, [fetchAvailableModels]);

  const selectUser = async (user) => {
    setSelectedUser(user);
    setEditRole(user.role);
    setEditName(user.name || '');
    setModelAccessSaveMsg('');
    setSelectedUserLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSelectedUser(data);
        // Build model access map
        const accessMap = {};
        for (const ma of data.modelAccess || []) {
          accessMap[`${ma.provider}:${ma.model_id}`] = !!ma.enabled;
        }
        setModelAccess(accessMap);
      }
    } catch (err) {
      console.error('[AdminPanel] Failed to load user detail:', err);
    } finally {
      setSelectedUserLoading(false);
    }

    // Fetch this user's usage stats (async, non-blocking)
    setUserUsageLoading(true);
    try {
      const usageRes = await fetch(`/api/usage?userId=${user.id}`, { headers });
      if (usageRes.ok) {
        setUserUsage(await usageRes.json());
      }
    } catch (err) {
      console.error('[AdminPanel] Failed to fetch user usage:', err);
    } finally {
      setUserUsageLoading(false);
    }
  };

  const saveUserEdit = async () => {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ name: editName || null, role: editRole }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedUser(data.user);
        fetchUsers();
      }
    } catch (err) {
      console.error('[AdminPanel] Failed to save user:', err);
    } finally {
      setEditSaving(false);
    }
  };

  const toggleModelAccess = (provider, modelId) => {
    const key = `${provider}:${modelId}`;
    setModelAccess(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const saveModelAccess = async () => {
    setModelAccessSaving(true);
    setModelAccessSaveMsg('');
    try {
      const entries = [];
      for (const prov of providerOrder) {
        for (const m of (availableModels[prov] || [])) {
          const key = `${prov}:${m.id}`;
          if (key in modelAccess) {
            entries.push({ provider: prov, modelId: m.id, enabled: modelAccess[key] });
          }
        }
      }
      const res = await fetch(`/api/admin/users/${selectedUser.id}/model-access`, {
        method: 'PUT', headers,
        body: JSON.stringify({ modelAccess: entries }),
      });
      if (res.ok) {
        setModelAccessSaveMsg('Saved!');
        setTimeout(() => setModelAccessSaveMsg(''), 2000);
      } else {
        setModelAccessSaveMsg('Save failed');
      }
    } catch {
      setModelAccessSaveMsg('Save failed');
    } finally {
      setModelAccessSaving(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetPwError('');
    setResetPwSuccess('');
    if (resetPwNew.length < 8) { setResetPwError('At least 8 characters'); return; }
    if (resetPwNew !== resetPwConfirm) { setResetPwError('Passwords do not match'); return; }
    setResetPwLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/reset-password`, {
        method: 'POST', headers,
        body: JSON.stringify({ newPassword: resetPwNew }),
      });
      if (res.ok) {
        setResetPwSuccess('Password reset!');
        setResetPwNew(''); setResetPwConfirm('');
        setTimeout(() => { setResetPwOpen(false); setResetPwError(''); setResetPwSuccess(''); }, 1500);
      } else {
        const data = await res.json();
        setResetPwError(data.error?.message || 'Failed');
      }
    } catch {
      setResetPwError('Network error');
    } finally {
      setResetPwLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    if (!createEmail || !createPassword) { setCreateError('Email and password required'); return; }
    if (createPassword.length < 8) { setCreateError('Password must be at least 8 characters'); return; }
    setCreateLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST', headers,
        body: JSON.stringify({ email: createEmail, password: createPassword, name: createName || null, role: createRole }),
      });
      if (res.ok) {
        setCreateSuccess('User created!');
        setCreateEmail(''); setCreatePassword(''); setCreateName(''); setCreateRole('user');
        fetchUsers();
        setTimeout(() => { setCreateOpen(false); setCreateError(''); setCreateSuccess(''); }, 1500);
      } else {
        const data = await res.json();
        setCreateError(data.error?.message || 'Failed to create user');
      }
    } catch {
      setCreateError('Network error');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers });
      if (res.ok) {
        if (selectedUser?.id === userId) setSelectedUser(null);
        fetchUsers();
      }
    } catch (err) {
      console.error('[AdminPanel] Failed to delete user:', err);
    } finally {
      setDeleteUserId(null);
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      {/* User list panel */}
      <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
          <div>
            <h3 className="text-base font-medium text-white">Users</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Manage accounts and model access</p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New User
          </button>
        </div>

        {/* Search & Filter */}
        <div className="flex gap-3 px-5 py-3 border-b border-zinc-800/30">
          <input
            type="text" value={userSearch} onChange={e => setUserSearch(e.target.value)}
            placeholder="Search by email..."
            className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
          />
          <select
            value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-indigo-600/50"
          >
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
        </div>

        {/* User Table */}
        <div className="overflow-x-auto">
          {usersLoading ? (
            <div className="p-8 text-center">
              <svg className="animate-spin h-5 w-5 text-zinc-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
              <p className="text-sm text-zinc-500">Loading users...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">No users found</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800/40 text-zinc-500 text-xs">
                  <th className="text-left px-5 py-3 font-medium">Email</th>
                  <th className="text-left px-5 py-3 font-medium">Name</th>
                  <th className="text-left px-5 py-3 font-medium">Role</th>
                  <th className="text-left px-5 py-3 font-medium">Created</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className={`border-b border-zinc-800/20 hover:bg-zinc-800/30 transition-colors cursor-pointer ${selectedUser?.id === u.id ? 'bg-indigo-600/10' : ''}`}
                    onClick={() => selectUser(u)}>
                    <td className="px-5 py-3 text-zinc-200">{u.email}</td>
                    <td className="px-5 py-3 text-zinc-400">{u.name || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-zinc-700/50 text-zinc-400 border border-zinc-700/30'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-zinc-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setDeleteUserId(u.id)}
                        className="text-zinc-600 hover:text-red-400 p-1 transition-colors"
                        title="Delete user"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Selected user detail */}
      {selectedUser && (
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-6">
          {selectedUserLoading ? (
            <div className="flex items-center justify-center py-8">
              <svg className="animate-spin h-5 w-5 text-zinc-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium text-white">User Detail — {selectedUser.email}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setResetPwOpen(true)}
                    className="px-3 py-1.5 bg-zinc-800 border border-zinc-700/40 text-zinc-300 rounded-lg text-xs hover:bg-zinc-700 transition-colors"
                  >
                    Reset Password
                  </button>
                </div>
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Name</label>
                  <input
                    type="text" value={editName} onChange={e => setEditName(e.target.value)}
                    placeholder="User name"
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Role</label>
                  <select
                    value={editRole} onChange={e => setEditRole(e.target.value)}
                    className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-indigo-600/50"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div className="mb-6">
                <button
                  onClick={saveUserEdit}
                  disabled={editSaving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>

              {/* Model Access Provisioning */}
              <div className="border-t border-zinc-800/40 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-white">Model Access</h4>
                  <div className="flex items-center gap-2">
                    {modelAccessSaveMsg && (
                      <span className={`text-xs ${modelAccessSaveMsg === 'Saved!' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {modelAccessSaveMsg}
                      </span>
                    )}
                    <button
                      onClick={saveModelAccess}
                      disabled={modelAccessSaving}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                    >
                      {modelAccessSaving ? 'Saving...' : 'Save Access'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mb-3">
                  Check a model to allow this user to use it. Uncheck to block. If no models are checked, the user cannot access any models.
                </p>

                {/* Provider tabs */}
                <div className="flex gap-1 border-b border-zinc-800/30 mb-3">
                  {providerOrder.map(prov => (
                    <button
                      key={prov}
                      onClick={() => setAccessProviderTab(prov)}
                      className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                        accessProviderTab === prov
                          ? 'border-indigo-600 text-white'
                          : 'border-transparent text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {PROVIDER_LABELS[prov] || prov}
                    </button>
                  ))}
                </div>

                {/* Model checkboxes for selected provider */}
                {modelsLoading ? (
                  <div className="py-4 text-center">
                    <svg className="animate-spin h-4 w-4 text-zinc-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
                    <p className="text-xs text-zinc-500">Loading models...</p>
                  </div>
                ) : modelsError ? (
                  <p className="text-xs text-red-400 py-4">{modelsError}</p>
                ) : (availableModels[accessProviderTab] || []).length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4">No models found for this provider. Make sure API keys are configured.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {(availableModels[accessProviderTab] || []).map(m => {
                      const key = `${accessProviderTab}:${m.id}`;
                      const checked = modelAccess[key] ?? false;
                      return (
                        <label key={key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/20 cursor-pointer hover:bg-zinc-800/50 transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleModelAccess(accessProviderTab, m.id)}
                            className="rounded bg-zinc-700 border-zinc-600 text-indigo-600 focus:ring-indigo-600/30"
                          />
                          <span className="text-xs text-zinc-300">{m.name}</span>
                          <span className="text-[10px] text-zinc-600 ml-auto">{m.id}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* User Usage Stats */}
              <div className="border-t border-zinc-800/40 pt-5">
                <h4 className="text-sm font-medium text-white mb-3">Usage</h4>
                {userUsageLoading ? (
                  <div className="py-4 text-center">
                    <svg className="animate-spin h-4 w-4 text-zinc-500 mx-auto" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
                  </div>
                ) : !userUsage || !userUsage.byProvider || Object.keys(userUsage.byProvider).length === 0 ? (
                  <p className="text-xs text-zinc-500">No usage data yet.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(userUsage.byProvider).map(([provider, data]) => (
                      <div key={provider} className="bg-zinc-800/30 rounded-lg border border-zinc-700/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-zinc-300 capitalize">{provider}</span>
                          <span className="text-xs text-zinc-500">{data.requestCount} requests</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <div className="text-center">
                            <div className="text-xs font-mono text-zinc-300">{(data.promptTokens || 0).toLocaleString()}</div>
                            <div className="text-[10px] text-zinc-500">prompt</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs font-mono text-zinc-300">{(data.completionTokens || 0).toLocaleString()}</div>
                            <div className="text-[10px] text-zinc-500">completion</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs font-mono text-zinc-300">{(data.totalTokens || 0).toLocaleString()}</div>
                            <div className="text-[10px] text-zinc-500">total</div>
                          </div>
                        </div>
                        {/* Per-model breakdown */}
                        {data.byModel && Object.keys(data.byModel).length > 0 && (
                          <div className="border-t border-zinc-700/30 pt-2 mt-1">
                            {Object.entries(data.byModel).map(([model, md]) => (
                              <div key={model} className="flex items-center justify-between py-1">
                                <span className="text-[11px] text-zinc-400 truncate max-w-[140px]">{model}</span>
                                <span className="text-[11px] font-mono text-zinc-500">{md.totalTokens?.toLocaleString()} tok / {md.requestCount} req</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPwOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" onClick={() => { setResetPwOpen(false); setResetPwError(''); setResetPwSuccess(''); }} />
          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-sm font-semibold text-white mb-4">Reset Password for {selectedUser?.email}</h3>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">New Password</label>
                <input
                  type="password" value={resetPwNew} onChange={e => { setResetPwNew(e.target.value); setResetPwError(''); setResetPwSuccess(''); }}
                  placeholder="At least 8 characters"
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Confirm Password</label>
                <input
                  type="password" value={resetPwConfirm} onChange={e => { setResetPwConfirm(e.target.value); setResetPwError(''); setResetPwSuccess(''); }}
                  placeholder="Re-enter password"
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                />
              </div>
              {resetPwError && <p className="text-xs text-red-400">{resetPwError}</p>}
              {resetPwSuccess && <p className="text-xs text-emerald-400">{resetPwSuccess}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setResetPwOpen(false); setResetPwError(''); setResetPwSuccess(''); }}
                  className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700/40 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={resetPwLoading}
                  className="flex-1 px-3 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-500 disabled:opacity-50 transition-colors">
                  {resetPwLoading ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" onClick={() => { setCreateOpen(false); setCreateError(''); setCreateSuccess(''); }} />
          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-sm font-semibold text-white mb-4">Create New User</h3>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Email</label>
                <input
                  type="email" value={createEmail} onChange={e => { setCreateEmail(e.target.value); setCreateError(''); setCreateSuccess(''); }}
                  placeholder="user@example.com"
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Password</label>
                <input
                  type="password" value={createPassword} onChange={e => { setCreatePassword(e.target.value); setCreateError(''); setCreateSuccess(''); }}
                  placeholder="At least 8 characters"
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Name (optional)</label>
                <input
                  type="text" value={createName} onChange={e => setCreateName(e.target.value)}
                  placeholder="Display name"
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-indigo-600/50"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Role</label>
                <select
                  value={createRole} onChange={e => setCreateRole(e.target.value)}
                  className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-3 py-2.5 text-sm text-zinc-300 focus:outline-none focus:border-indigo-600/50"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {createError && <p className="text-xs text-red-400">{createError}</p>}
              {createSuccess && <p className="text-xs text-emerald-400">{createSuccess}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setCreateOpen(false); setCreateError(''); setCreateSuccess(''); }}
                  className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700/40 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={createLoading}
                  className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors">
                  {createLoading ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" onClick={() => setDeleteUserId(null)} />
          <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-sm font-semibold text-white mb-2">Delete User?</h3>
            <p className="text-sm text-zinc-400 mb-4">This permanently deletes the user, all their chats, API keys, and settings. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteUserId(null)}
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700/40 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDeleteUser(deleteUserId)}
                className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-500 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
