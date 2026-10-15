"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api";
import {
  clearAuthSession,
  readStoredSession,
  storeAuthSession,
  toAuthenticatedUser,
  type AuthenticatedUser,
  type AuthSession,
} from "@/lib/auth";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  user: AuthenticatedUser | null;
  signIn: (session: AuthSession) => void;
  signOut: () => void;
  replaceUser: (user: AuthenticatedUser) => void;
  refreshUser: () => Promise<AuthenticatedUser | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getInitialSession() {
  return typeof window === "undefined" ? null : readStoredSession();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialSession = getInitialSession();
  const [session, setSession] = useState<AuthSession | null>(initialSession);
  const [status, setStatus] = useState<AuthStatus>(initialSession ? "loading" : "unauthenticated");

  const signOut = useCallback(() => {
    clearAuthSession();
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const signIn = useCallback((nextSession: AuthSession) => {
    const normalizedSession = {
      accessToken: nextSession.accessToken,
      user: toAuthenticatedUser(nextSession.user),
      persist: nextSession.persist ?? true,
    };
    storeAuthSession(normalizedSession);
    setSession(normalizedSession);
    setStatus("authenticated");
  }, []);

  const replaceUser = useCallback((user: AuthenticatedUser) => {
    setSession((currentSession) => {
      if (!currentSession) {
        return currentSession;
      }

      const nextSession = {
        ...currentSession,
        user: toAuthenticatedUser(user),
        persist: currentSession.persist ?? true,
      };
      storeAuthSession(nextSession);
      return nextSession;
    });
    setStatus("authenticated");
  }, []);

  const refreshUser = useCallback(async () => {
    const currentSession = readStoredSession();
    if (!currentSession?.accessToken) {
      signOut();
      return null;
    }

    const result = await apiRequest<AuthenticatedUser>("/auth/me", {
      authToken: currentSession.accessToken,
      cache: "no-store",
    });

    if (!result.success || !result.data) {
      signOut();
      return null;
    }

    const nextSession = {
      accessToken: currentSession.accessToken,
      user: toAuthenticatedUser(result.data),
      persist: currentSession.persist ?? true,
    };
    signIn(nextSession);
    return nextSession.user;
  }, [signIn, signOut]);

  useEffect(() => {
    if (!session?.accessToken) {
      setStatus("unauthenticated");
      return;
    }

    setStatus("loading");
    void refreshUser();
  }, [refreshUser, session?.accessToken]);

  const value = useMemo(() => ({ status, session, user: session?.user ?? null, signIn, signOut, replaceUser, refreshUser }), [refreshUser, replaceUser, session, signIn, signOut, status]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}