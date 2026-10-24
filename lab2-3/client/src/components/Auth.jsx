// Состояние входа: текущий пользователь, его права, вход/выход.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, refreshSession, setAccessToken, setOnAuthLost } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false); // пока не знаем, вошёл ли пользователь
  const [signedOut, setSignedOut] = useState(false); // пользователь сам нажал «Выйти»

  // При открытии страницы пробуем восстановить вход по refresh-cookie
  useEffect(() => {
    setOnAuthLost(() => {
      setAccessToken(null);
      setUser(null);
    });
    refreshSession().then((u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  const applyTokens = useCallback((data) => {
    setAccessToken(data.accessToken);
    setSignedOut(false);
    setUser(data.user);
  }, []);

  const value = {
    user,
    ready,
    signedOut,
    can: (permission) => Boolean(user?.permissions?.includes(permission)),
    login: async (email, password) => applyTokens(await api.login(email, password)),
    register: async (data) => applyTokens(await api.register(data)),
    logout: async () => {
      try {
        await api.logout();
      } finally {
        setAccessToken(null);
        setSignedOut(true);
        setUser(null);
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
