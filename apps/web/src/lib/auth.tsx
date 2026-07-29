import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getStoredEmail, setStoredEmail } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredEmail();

    if (!stored) {
      setLoading(false);
      return;
    }

    api
      .me()
      .then(setUser)
      .catch(() => setStoredEmail(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string) => {
    setStoredEmail(email);

    try {
      setUser(await api.login(email));
    } catch (error) {
      setStoredEmail(null);
      throw error;
    }
  }, []);

  const signOut = useCallback(() => {
    setStoredEmail(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
