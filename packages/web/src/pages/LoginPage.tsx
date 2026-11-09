import { useState, type FormEvent } from 'react';
import type { Meta } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner } from '../components/ui';
import { useAction, useApiData } from '../hooks/useApiData';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { run, pending, error } = useAction(login);
  // Demo deployments publish their sign-in details; real ones return `demo: null`.
  const meta = useApiData((api) => api.get<Meta>('/api/meta'), []);
  const demoAccounts = meta.data?.demo?.accounts ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(username, password);
  };

  return (
    <div className="login">
      <section className="login-card">
        <img src="/favicon.svg" alt="" width={56} height={56} />
        <h1>Spaceship X26</h1>
        <p className="muted">Passenger Resource Management System</p>

        <form onSubmit={submit} className="form">
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <ErrorBanner error={error} />
          <button type="submit" className="button primary" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {demoAccounts.length > 0 && (
          <details className="demo-accounts" open>
            <summary>Demo accounts</summary>
            <p className="muted small">Pick a role to fill in its sign-in details.</p>
            <ul>
              {demoAccounts.map((account) => (
                <li key={account.username}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setUsername(account.username);
                      setPassword(account.password);
                    }}
                  >
                    {account.label}: <code>{account.username}</code>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
