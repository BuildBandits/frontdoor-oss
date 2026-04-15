import { useEffect, useState } from 'react';

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
  const [loadFailed, setLoadFailed] = useState(false);
  const avatarSrc = userId ? `/api/users/${encodeURIComponent(userId)}/avatar` : null;
  const showImage = Boolean(avatarSrc) && !loadFailed;

  useEffect(() => {
    setLoadFailed(false);
  }, [avatarSrc]);

  return (
    <div
      className={`relative overflow-hidden rounded-full flex items-center justify-center flex-shrink-0 ${className}`}
      style={!showImage ? { backgroundColor: avatarColor || '#666' } : undefined}
    >
      {showImage ? (
        <img
          src={avatarSrc}
          alt={displayName ? `${displayName} avatar` : 'Avatar utente'}
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
