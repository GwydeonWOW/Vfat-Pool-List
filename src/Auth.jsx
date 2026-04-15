import { useState, useEffect } from 'react';

const TOKEN_KEY = 'vfat_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function isAuthenticated() {
  return !!getToken();
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
}

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...options.headers, Authorization: `Bearer ${token}` };
  return fetch(url, { ...options, headers });
}

export { authFetch };

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  useEffect(() => {
    if (isAuthenticated()) onLogin();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        onLogin();
      } else {
        setError('Invalid username or password');
      }
    } catch {
      setError('Connection error');
    }
  };

  const handleChangeCredentials = async (e) => {
    e.preventDefault();
    if (!newUser || !newPass) {
      setSettingsMsg('Username and password required');
      return;
    }
    try {
      const res = await authFetch('/api/auth/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUser, password: newPass }),
      });
      const data = await res.json();
      if (data.ok) {
        setSettingsMsg('Credentials updated. Log in with new credentials.');
        setShowSettings(false);
        setNewUser('');
        setNewPass('');
      } else {
        setSettingsMsg(data.error || 'Failed');
      }
    } catch {
      setSettingsMsg('Connection error');
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-box">
        <h1>VFat Pool Analyzer</h1>
        <p className="login-subtitle">Sign in to continue</p>

        <form onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(''); }}
            className="login-input"
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            className="login-input"
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn">Sign In</button>
        </form>

        {isAuthenticated() && (
          <>
            <button
              className="login-settings-toggle"
              onClick={() => setShowSettings(!showSettings)}
            >
              {showSettings ? 'Hide' : 'Change'} credentials
            </button>

            {showSettings && (
              <form onSubmit={handleChangeCredentials} className="login-settings">
                <input
                  type="text"
                  placeholder="New username"
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                  className="login-input"
                />
                <input
                  type="password"
                  placeholder="New password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="login-input"
                />
                <button type="submit" className="login-btn login-btn-secondary">Save Credentials</button>
                {settingsMsg && <div className="login-msg">{settingsMsg}</div>}
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
