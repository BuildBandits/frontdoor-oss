import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  // Only user profile data in localStorage (non-sensitive). Token lives only in httpOnly cookie.
  user: JSON.parse(localStorage.getItem('frontdoor_user') || 'null'),
  isAuthenticated: !!localStorage.getItem('frontdoor_user'),

  loginWithToken: (_token, user) => {
    // Token is already set as httpOnly cookie by the server callback.
    // We only persist user profile data for the UI.
    localStorage.setItem('frontdoor_user', JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Continue logout even if API call fails
    }
    localStorage.removeItem('frontdoor_user');
    set({ user: null, isAuthenticated: false });
  },

  updateUser: (user) => {
    localStorage.setItem('frontdoor_user', JSON.stringify(user));
    set({ user });
  },
}));
