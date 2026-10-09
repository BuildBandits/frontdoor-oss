import axios from 'axios';
import { loginPathFor } from '../utils/returnPath';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // Send httpOnly cookie with every request
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('frontdoor_user');
      // Come back to the current page after signing in again.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = loginPathFor(window.location);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
