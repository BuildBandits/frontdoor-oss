import { create } from 'zustand';
import api from '../services/api';

const STORAGE_KEY = 'frontdoor_user';

// A missing or corrupted cached profile must not break the whole app.
function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable.
    }
    return null;
  }
}

// Not secret (the server cookie is the authority): only keeps the UI read-only until /auth/me answers after a reload.
const IMPERSONATION_KEY = 'frontdoor_impersonation_state';

function readStoredImpersonation() {
  try {
    return JSON.parse(localStorage.getItem(IMPERSONATION_KEY) || 'null');
  } catch {
    try {
      localStorage.removeItem(IMPERSONATION_KEY);
    } catch {
      // Storage unavailable.
    }
    return null;
  }
}

function persistImpersonation(impersonation) {
  try {
    if (impersonation) localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(impersonation));
    else localStorage.removeItem(IMPERSONATION_KEY);
  } catch {
    // Storage unavailable.
  }
}

const storedUser = readStoredUser();
const storedImpersonation = storedUser ? readStoredImpersonation() : null;

function serializeUser(user) {
  if (!user) return null;
  return { ...user };
}

export const useAuthStore = create((set, get) => ({
  // Only user profile data in localStorage (non-sensitive). Token lives only in httpOnly cookie.
  user: storedUser,
  isAuthenticated: Boolean(storedUser),
  // Set while an admin acts as another user ({ sessionId, actor, expiresAt, reason }).
  impersonation: storedImpersonation,
  impersonationEndedNotice: false,

  applySession: ({ user, impersonation = null }) => {
    const endedOnItsOwn = Boolean(get().impersonation) && !impersonation;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeUser(user)));
    persistImpersonation(impersonation);
    set({ user, isAuthenticated: true, impersonation, impersonationEndedNotice: endedOnItsOwn || get().impersonationEndedNotice });
  },

  refreshSession: async () => {
    const res = await api.get('/auth/me');
    if (res.data?.user) get().applySession(res.data);
    return res.data;
  },

  startImpersonation: async (userId, reason) => {
    await api.post('/impersonation', { userId, reason });
    return get().refreshSession();
  },

  stopImpersonation: async () => {
    await api.post('/impersonation/stop');
    // Cleared first, so a manual stop is not reported as "ended on its own".
    set({ impersonation: null });
    try {
      return await get().refreshSession();
    } catch {
      // Stopped on the server but the profile is still the impersonated one: reload instead of leaving it writable.
      window.location.assign('/admin/users');
      return null;
    }
  },

  dismissImpersonationEndedNotice: () => set({ impersonationEndedNotice: false }),

  loginWithToken: (_token, user) => {
    // Token is already set as httpOnly cookie by the server callback.
    // We only persist user profile data for the UI.
    const cachedUser = serializeUser(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedUser));
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', keepalive: true });
    } catch {
      // Continue logout even if API call fails
    }
    localStorage.removeItem(STORAGE_KEY);
    persistImpersonation(null);
    set({ user: null, isAuthenticated: false, impersonation: null, impersonationEndedNotice: false });
  },

  updateUser: (user) => {
    const cachedUser = serializeUser(user);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedUser));
    set({ user });
  },

  savePreferences: async (preferences, options = {}) => {
    // Impersonation is read-only: the server refuses it anyway, so do not even try.
    if (get().impersonation) return get().user;
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
