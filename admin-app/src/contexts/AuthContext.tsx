import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Preferences } from '@capacitor/preferences';
import axios from 'axios';
import { API_BASE } from '@gonidhi/shared';

interface User {
  id: string;
  name: string;
  role: string;
  phone: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);

  const logout = async () => {
    await Preferences.remove({ key: 'adminToken' });
    await Preferences.remove({ key: 'adminUser' });
    delete axios.defaults.headers.common['Authorization'];
    setIsAuthenticated(false);
    setUser(null);
  };

  useEffect(() => {
    const initAuth = async () => {
      const { value: token } = await Preferences.get({ key: 'adminToken' });
      const { value: storedUser } = await Preferences.get({ key: 'adminUser' });
      if (token && storedUser) {
        try {
          const response = await axios.get(`${API_BASE}/api/admin/auth/verify`, {
             headers: { Authorization: `Bearer ${token}` }
          });
          if (response.data.success) {
            setIsAuthenticated(true);
            setUser(JSON.parse(storedUser));
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          } else {
            await logout();
          }
        } catch (error) {
          await logout();
        }
      } else {
        await logout();
      }
    };
    initAuth();
  }, []);

  const login = async (token: string, userData: User) => {
    await Preferences.set({ key: 'adminToken', value: token });
    await Preferences.set({ key: 'adminUser', value: JSON.stringify(userData) });
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setIsAuthenticated(true);
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
