import { create } from 'zustand';
import api from '../services/api';

const STORAGE_KEY = 'frontdoor_user';

function serializeUser(user) {
  if (!user) return null;
  return { ...user };
}

export const useAuthStore = create((set, get) => ({
  // Only user profile data in localStorage (non-sensitive). Token lives only in httpOnly cookie.
  user: JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'),
  isAuthenticated: !!localStorage.getItem(STORAGE_KEY),

  loginWithToken: (_token, user) => {
    // Token is already set as httpOnly cookie by the server callback.
    // We only persist user profile data for the UI.
    const cachedUser = serializeUser(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedUser));
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Continue logout even if API call fails
    }
    localStorage.removeItem(STORAGE_KEY);
    set({ user: null, isAuthenticated: false });
  },

  updateUser: (user) => {
    const cachedUser = serializeUser(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedUser));
    set({ user });
  },

  savePreferences: async (preferences, options = {}) => {
    const previousUser = get().user;
    const optimisticUser = previousUser ? { ...previousUser, ...preferences } : { ...preferences };
    if (Object.prototype.hasOwnProperty.call(preferences, 'appOrder')) {
      optimisticUser.appOrderUpdatedAt = Array.isArray(preferences.appOrder) ? new Date().toISOString() : null;
    }
    if (Object.prototype.hasOwnProperty.call(preferences, 'favoriteApps')) {
      optimisticUser.favoriteAppsUpdatedAt = Array.isArray(preferences.favoriteApps) ? new Date().toISOString() : null;
    }
    set({ user: optimisticUser, isAuthenticated: true });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeUser(optimisticUser)));

    try {
      const requestBody = { ...preferences, ...options.requestBodyExtras };
      const res = await api.put('/auth/me/preferences', requestBody);
      const nextUser = res.data.user;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeUser(nextUser)));
      set({ user: nextUser, isAuthenticated: true });
      return nextUser;
    } catch (error) {
      if (previousUser) {
        set({ user: previousUser, isAuthenticated: true });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeUser(previousUser)));
      }
      throw error;
    }
  },

  updateHomeDesktopView: async (homeDesktopView) => get().savePreferences({ homeDesktopView }),

  resetHomeDesktopView: async () => get().savePreferences({ homeDesktopView: null }),

  updatePreferredLanguage: async (preferredLanguage) => get().savePreferences({ preferredLanguage }),

  resetPreferredLanguage: async () => get().savePreferences({ preferredLanguage: null }),

  updatePreferredTimeZone: async (preferredTimeZone) => get().savePreferences({ preferredTimeZone }),

  resetPreferredTimeZone: async () => get().savePreferences({ preferredTimeZone: null }),

  updatePreferredColorScheme: async (preferredColorScheme) => get().savePreferences({ preferredColorScheme }),

  resetPreferredColorScheme: async () => get().savePreferences({ preferredColorScheme: null }),

  updateAppOrder: async (appOrder) => get().savePreferences({ appOrder }),

  resetAppOrder: async () => get().savePreferences({ appOrder: null }),

  updateFavoriteApps: async (favoriteApps, options = {}) => get().savePreferences(
    { favoriteApps },
    options.migration ? { requestBodyExtras: { favoriteAppsMigrationFromLocalStorage: true } } : {}
  ),

  resetFavoriteApps: async () => get().savePreferences({ favoriteApps: null }),

  markHomeTourSeen: async () => get().savePreferences({ homeTourSeenAt: new Date().toISOString() }),

  resetHomeTourSeen: async () => get().savePreferences({ homeTourSeenAt: null }),
}));
