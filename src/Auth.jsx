import { useState, useEffect } from 'react';

const AUTH_KEY = 'vfat_auth';

const DEFAULT_USER = {
  username: 'admin',
  password: 'vfat2024',
};

function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return DEFAULT_USER;
    return JSON.parse(raw);
  } catch {
    return DEFAULT_USER;
  }
}

function saveUser(user) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

export function isLoggedIn() {
  return sessionStorage.getItem('vfat_session') === 'true';
}

export function logout() {
  sessionStorage.removeItem('vfat_session');
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  useEffect(() => {
    if (isLoggedIn()) onLogin();
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    const user = getStoredUser();
    if (username === user.username && password === user.password) {
      sessionStorage.setItem('vfat_session', 'true');
      onLogin();
    } else {
      setError('Invalid username or password');
    }
  };

  const handleChangeCredentials = (e) => {
    e.preventDefault();
    if (!newUser || !newPass) {
      setSettingsMsg('Username and password required');
      return;
    }
    saveUser({ username: newUser, password: newPass });
    setSettingsMsg('Credentials updated. Log in with new credentials.');
    setShowSettings(false);
    setNewUser('');
    setNewPass('');
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
      </div>
    </div>
  );
}
