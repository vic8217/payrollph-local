import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { appApi } from "@/lib/appApi";

const AuthContext = createContext();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 1000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const idleTimerRef = useRef(null);
  const lastTouchRef = useRef(0);
  const sessionExitRef = useRef(false);

  const checkAppState = async () => {
    try {
      const currentUser = await appApi.auth.me({ force: true });
      setUser(currentUser);
      return currentUser;
    } catch {
      setUser(null);
      return null;
    } finally {
      setIsLoadingAuth(false);
    }
  };

  useEffect(() => {
    checkAppState();
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    let disposed = false;
    const signOutForInactivity = () => {
      if (!disposed) appApi.auth.logout("/landing");
    };
    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(signOutForInactivity, IDLE_TIMEOUT_MS);
    };
    const recordActivity = () => {
      resetIdleTimer();
      const now = Date.now();
      if (now - lastTouchRef.current < TOUCH_INTERVAL_MS) return;
      lastTouchRef.current = now;
      appApi.auth.touch().catch((error) => {
        // During maintenance, an expired session is rejected by the proxy with
        // 503 before the touch endpoint can renew it. Do not leave a stale app
        // shell visible after either an explicit expiry (401) or that rejected
        // maintenance-session request.
        if (![401, 503].includes(error?.status) || sessionExitRef.current) return;
        sessionExitRef.current = true;
        setUser(null);
        appApi.auth.logout("/landing");
      });
    };
    const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));
    recordActivity();

    return () => {
      disposed = true;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((event) => window.removeEventListener(event, recordActivity));
    };
  }, [user]);

  const logout = () => appApi.auth.logout("/landing");
  const navigateToLogin = () => appApi.auth.redirectToLogin();

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoadingAuth,
        isLoadingPublicSettings: false,
        authError: null,
        appPublicSettings: null,
        logout,
        navigateToLogin,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
