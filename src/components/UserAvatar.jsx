import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingLanguage } from '../stores/brandingStore';
import { formatMessage, getUiStrings, resolveAppLanguage } from '../i18n';

const AVATAR_CACHE_VERSION_KEY = 'frontdoor_avatar_cache_version';

function getAvatarCacheVersion() {
  try {
    return window.localStorage.getItem(AVATAR_CACHE_VERSION_KEY) || '0';
  } catch {
    return '0';
  }
}

function getInitials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

export default function UserAvatar({
  userId,
  displayName,
  email,
  avatarColor = '#666',
  className = 'w-9 h-9',
  initialsClassName = 'text-xs',
}) {
  const preferredLanguage = useAuthStore((state) => state.user?.preferredLanguage);
  const brandingLanguage = useBrandingLanguage();
  const ui = getUiStrings(resolveAppLanguage(preferredLanguage, brandingLanguage));
  const [loadFailed, setLoadFailed] = useState(false);
  const [cacheVersion, setCacheVersion] = useState(getAvatarCacheVersion());
  const avatarSrc = userId ? `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(cacheVersion)}` : null;
  const showImage = Boolean(avatarSrc) && !loadFailed;

  useEffect(() => {
    setLoadFailed(false);
  }, [avatarSrc]);

  useEffect(() => {
    const refreshCacheVersion = () => setCacheVersion(getAvatarCacheVersion());
    window.addEventListener('frontdoor:avatar-cache-refresh', refreshCacheVersion);
    window.addEventListener('storage', refreshCacheVersion);
    return () => {
      window.removeEventListener('frontdoor:avatar-cache-refresh', refreshCacheVersion);
      window.removeEventListener('storage', refreshCacheVersion);
    };
  }, []);

  return (
    <div
      className={`relative overflow-hidden rounded-full flex items-center justify-center shrink-0 ${className}`}
      style={!showImage ? { backgroundColor: avatarColor || '#666' } : undefined}
    >
      {showImage ? (
        <img
          src={avatarSrc}
          alt={displayName ? formatMessage(ui.common.userAvatarNamed, { name: displayName }) : ui.common.userAvatar}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <span className={`font-bold text-white select-none ${initialsClassName}`}>
          {getInitials(displayName || email)}
        </span>
      )}
    </div>
  );
}
