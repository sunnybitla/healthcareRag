'use client';

import React, { useState, useEffect } from 'react';
import ChatView from './components/ChatView';
import DocumentManager from './components/DocumentManager';
import SemanticSearch from './components/SemanticSearch';
import AnalyticsDashboard from './components/AnalyticsDashboard';

interface User {
  username: string;
  role: string;
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'documents' | 'search' | 'analytics'>('chat');
  const [apiStatus, setApiStatus] = useState<{ isMock: boolean; online: boolean }>({ isMock: true, online: false });

  // Auth form states
  const [isRegister, setIsRegister] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [roleInput, setRoleInput] = useState<'Guest' | 'Registered User' | 'Admin'>('Registered User');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Load auth state from local storage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('auth_user');

    if (!savedToken) {
      return;
    }

    try {
      const base64Url = savedToken.split('.')[1];
      if (!base64Url) {
        throw new Error('Missing JWT payload');
      }
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64));
      const expiryMs = Number(payload.exp || 0) * 1000;

      if (Date.now() >= expiryMs) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        return;
      }
    } catch (err) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      return;
    }

    if (savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // Poll system status to show in Sidebar
  useEffect(() => {
    if (token) {
      checkApiStatus();
    }
  }, [token]);

  const checkApiStatus = async () => {
    try {
      // Use analytics endpoint to infer API status if admin, or general check
      const res = await fetch(`${backendUrl}/api/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        // Just verify server connection is online
        // Let's also check if they are admin to query actual mock status, or set to false/true based on fallback
        setApiStatus({ isMock: false, online: true });
        
        // If Admin, query detailed analytics
        if (user?.role === 'Admin') {
          const resAnalytic = await fetch(`${backendUrl}/api/analytics`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resAnalytic.ok) {
            const data = await resAnalytic.json();
            setApiStatus({
              isMock: data.system_status.status === 'Mock Mode',
              online: true
            });
          }
        }
      }
    } catch (err) {
      setApiStatus({ isMock: true, online: false });
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim() || !passwordInput.trim() || authLoading) return;

    setAuthLoading(true);
    setAuthError(null);

    const endpoint = isRegister ? '/api/register' : '/api/login';
    const payload = isRegister 
      ? { username: usernameInput.trim(), password: passwordInput.trim(), role: roleInput }
      : { username: usernameInput.trim(), password: passwordInput.trim() };

    try {
      const res = await fetch(`${backendUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setToken(data.access_token);
        const loggedUser = { username: data.username, role: data.role };
        setUser(loggedUser);
        
        // Save to localStorage
        localStorage.setItem('auth_token', data.access_token);
        localStorage.setItem('auth_user', JSON.stringify(loggedUser));
        
        // Reset inputs
        setUsernameInput('');
        setPasswordInput('');
        setRoleInput('Registered User');
        
        // Set default landing tab based on role
        if (loggedUser.role === 'Guest') {
          setActiveTab('chat');
        } else {
          setActiveTab('chat');
        }
      } else {
        const errorData = await res.json();
        setAuthError(errorData.detail || 'Authentication failed.');
      }
    } catch (err) {
      setAuthError('Connection error. Is the FastAPI backend running?');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  };

  const renderActiveTab = () => {
    if (!token) return null;
    
    switch (activeTab) {
      case 'chat':
        return <ChatView token={token} userRole={user?.role || 'Guest'} />;
      case 'documents':
        return <DocumentManager token={token} userRole={user?.role || 'Guest'} />;
      case 'search':
        return <SemanticSearch token={token} />;
      case 'analytics':
        return <AnalyticsDashboard token={token} />;
      default:
        return <ChatView token={token} userRole={user?.role || 'Guest'} />;
    }
  };

  // 1. Unauthenticated View (Login/Register Card)
  if (!token) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'radial-gradient(circle at center, #121d33 0%, #060913 100%)', padding: '1rem' }}>
        <div className="glass-card" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem', boxShadow: '0 10px 40px rgba(0,0,0,0.4)', borderRadius: '20px' }}>
          
          {/* Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--primary), var(--secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.25rem', color: '#000', boxShadow: '0 0 20px rgba(0, 229, 255, 0.4)' }}>
              ⚕️
            </div>
            <h1 style={{ fontSize: '1.5rem', color: '#fff', fontWeight: 700, fontFamily: 'var(--font-display)', marginTop: '0.5rem' }}>
              Clinical RAG Hub
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
              Evidence-based guideline retrieval engine
            </p>
          </div>

          {authError && (
            <div style={{ padding: '0.75rem 1rem', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', color: 'var(--error)', fontSize: '0.8rem', marginBottom: '1.25rem', textAlign: 'center' }}>
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="e.g. clin_admin"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                required
                className="form-input"
                placeholder="••••••••"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
              />
            </div>

            {isRegister && (
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Clinical Role Assignment</label>
                <select 
                  className="form-select"
                  value={roleInput} 
                  onChange={(e) => setRoleInput(e.target.value as any)}
                >
                  <option value="Guest">Guest (Read-only query access, stateless)</option>
                  <option value="Registered User">Registered Practitioner (Dialog history, Search)</option>
                  <option value="Admin">Clinical System Administrator (Upload, Analytics, Full control)</option>
                </select>
              </div>
            )}

            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '0.9rem', marginTop: '0.5rem' }} disabled={authLoading}>
              {authLoading ? 'Signing in...' : isRegister ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setAuthError(null);
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
            >
              {isRegister ? 'Sign In' : 'Register Here'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Authenticated View (App Layout Shell)
  return (
    <div className="app-shell">
      {/* Left Sidebar Navigation */}
      <nav className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-icon">⚕️</div>
            <div className="brand-text">RAG Portal</div>
          </div>

          <ul className="nav-links">
            <li className="nav-item">
              <button
                className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                💬 Dialogue Agent
              </button>
            </li>
            
            {user?.role !== 'Guest' && (
              <li className="nav-item">
                <button
                  className={`nav-btn ${activeTab === 'search' ? 'active' : ''}`}
                  onClick={() => setActiveTab('search')}
                >
                  🔎 Semantic Lookup
                </button>
              </li>
            )}
            
            {user?.role === 'Admin' && (
              <>
                <li className="nav-item">
                  <button
                    className={`nav-btn ${activeTab === 'documents' ? 'active' : ''}`}
                    onClick={() => setActiveTab('documents')}
                  >
                    📁 Manage Guidelines
                  </button>
                </li>
                
                <li className="nav-item">
                  <button
                    className={`nav-btn ${activeTab === 'analytics' ? 'active' : ''}`}
                    onClick={() => setActiveTab('analytics')}
                  >
                    📊 System Metrics
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>

        {/* API connection status */}
        <div className="api-status">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-dimmed)' }}>AI Pipeline Status:</span>
            {apiStatus.online ? (
              <span className={`status-badge ${apiStatus.isMock ? 'mock' : 'online'}`}>
                {apiStatus.isMock ? 'Mock Mode' : 'AI Online'}
              </span>
            ) : (
              <span className="status-badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--error)' }}>
                Offline
              </span>
            )}
          </div>
        </div>

        {/* User profile section */}
        <div className="user-profile">
          <div className="user-avatar">
            {(user?.username || '').substring(0, 2).toUpperCase()}
          </div>
          <div className="user-info">
            <span className="username">{user?.username}</span>
            <span className="user-role">{user?.role}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Log Out">
            ➔
          </button>
        </div>
      </nav>

      {/* Main Content View Panel */}
      <main className="main-content">
        {renderActiveTab()}
      </main>
    </div>
  );
}
