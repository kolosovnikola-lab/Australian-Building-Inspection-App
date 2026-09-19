import { useSyncExternalStore } from 'react';

let role = 'manager';
let userId: string | null = null;
const listeners = new Set<() => void>();

export function setMockRole(nextRole: string) {
  role = nextRole;
  listeners.forEach((listener) => listener());
}

export function setMockUser(nextUserId: string | null) {
  userId = nextUserId;
  listeners.forEach((listener) => listener());
}

export function useAuth() {
  const currentRole = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => role,
  );
  return { sessionClaims: { metadata: { role: currentRole } } };
}

export function useClerk() {
  return {
    addListener: (listener: ({ user }: { user: { id: string } | null }) => void) => {
      const callback = () => listener({ user: userId ? { id: userId } : null });
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    signOut: async () => undefined,
  };
}

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return children;
}

export function Show({ children }: { children: React.ReactNode }) {
  return children;
}

export function SignIn() {
  return null;
}

export function SignUp() {
  return null;
}
