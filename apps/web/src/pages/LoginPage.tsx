import { useState, type FormEvent } from 'react';
import { Button, ErrorNote } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await signIn(email.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-sm border border-line bg-surface p-8"
      >
        <h1 className="text-xl font-semibold">Career Intelligence</h1>
        <p className="mt-1.5 text-sm text-muted">
          Compare your resume against job descriptions, with answers grounded in
          your own documents.
        </p>

        <label
          htmlFor="email"
          className="mt-7 mb-1.5 block text-sm font-medium"
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-sm border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        />

        <p className="mt-2 text-xs text-muted">
          No password — the address only separates your documents from everyone
          else&apos;s. It is not a security boundary.
        </p>

        {error && (
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        <div className="mt-6">
          <Button type="submit" disabled={busy || email.trim().length === 0}>
            {busy ? 'Signing in…' : 'Continue'}
          </Button>
        </div>
      </form>
    </div>
  );
}
