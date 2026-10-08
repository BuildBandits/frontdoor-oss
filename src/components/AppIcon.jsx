import { useEffect, useState } from 'react';

export default function AppIcon({ app, className = 'w-10 h-10', textClassName = 'text-3xl', alt = '' }) {
  const iconUrl = app?.iconUrl || app?.icon_url;
  const [iconLoadFailed, setIconLoadFailed] = useState(false);

  useEffect(() => {
    setIconLoadFailed(false);
  }, [iconUrl]);

  if (iconUrl && !iconLoadFailed) {
    return (
      <img
        src={iconUrl}
        alt={alt}
        onError={() => setIconLoadFailed(true)}
        // Decode only icons that are about to be visible: Home shows every app at once.
        loading="lazy"
        decoding="async"
        className={`${className} object-contain shrink-0`}
      />
    );
  }

  return (
    <span className={`${textClassName} shrink-0 leading-none`}>
      {app?.icon || '📦'}
    </span>
  );
}
