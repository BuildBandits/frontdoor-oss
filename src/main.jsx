import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { loadLanguage, resolveAppLanguage } from './i18n';
import { useAuthStore } from './stores/authStore';
import { useBrandingStore } from './stores/brandingStore';
import './index.css';

// Load only the dictionary of the language the first screen will use: the user's
// own choice, else the default language seen last time in this browser.
const initialLanguage = resolveAppLanguage(
  useAuthStore.getState().user?.preferredLanguage,
  useBrandingStore.getState().branding?.defaultLanguage,
);

function render() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

loadLanguage(initialLanguage)
  // A failed chunk load leaves no strings to show: retry with English once.
  .catch(() => loadLanguage('en'))
  .finally(render);
