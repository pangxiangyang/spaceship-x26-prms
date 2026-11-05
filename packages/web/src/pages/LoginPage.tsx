import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ErrorBanner } from '../components/ui';
import { useAction } from '../hooks/useApiData';

const DEMO_ACCOUNTS = [
  { username: 'commander', label: 'Crew Lead', password: 'crewlead123' },
  { username: 'sam.silver', label: 'Silver passenger', password: 'passenger123' },
  { username: 'gwen.gold', label: 'Gold passenger', password: 'passenger123' },
  { username: 'pia.platinum', label: 'Platinum passenger', password: 'passenger123' },
];

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { run, pending, error } = useAction(login);

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

        <details className="demo-accounts">
          <summary>Demo accounts</summary>
          <ul>
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.username}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setUsername(a.username);
                    setPassword(a.password);
                  }}
                >
                  {a.label}: <code>{a.username}</code>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
