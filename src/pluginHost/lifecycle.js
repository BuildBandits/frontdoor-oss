export const PLUGIN_LIFECYCLE_EVENT = 'frontdoor:plugin-registry-updated';
export const PLUGIN_LIFECYCLE_STORAGE_KEY = 'frontdoor_plugin_lifecycle';

export function notifyPluginLifecycle(detail = {}) {
  const message = {
    kind: detail.kind === 'branding' ? 'branding' : 'registry',
    reason: String(detail.reason || 'registry-updated'),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
  window.dispatchEvent(new CustomEvent(PLUGIN_LIFECYCLE_EVENT, { detail: message }));
  try {
    localStorage.setItem(PLUGIN_LIFECYCLE_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // The current tab still receives the CustomEvent when storage is unavailable.
  }
}
