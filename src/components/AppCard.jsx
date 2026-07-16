import { forwardRef, useState } from 'react';
import { Info, X, Lock, Star, GripVertical } from 'lucide-react';
import DOMPurify from 'dompurify';
import AppIcon from './AppIcon';
import Tooltip from './Tooltip';
import api from '../services/api';

const AppCard = forwardRef(function AppCard(
  { app, isFavorite, onToggleFavorite, showModeBadges = true, compact = false, dragHandleProps, dragging, style, tourHighlight = false, tourShowDragHandle = false, tourFavoriteRef = null, tourInfoRef = null, tourDragHandleRef = null, labels = {} },
  ref
) {
  const [showInfo, setShowInfo] = useState(false);
  const isExternal = app.mode === 'redirect' || app.mode === 'redirect-plain';
  const isInternalLink = app.mode === 'internal-link';
  const isSharedCookie = app.mode === 'shared-cookie';
  const isEntraApp = app.mode === 'entra-app';
  const hasLongDesc = app.long_description?.trim();
  const tags = Array.isArray(app.tags) ? app.tags : [];
  const description = app.description || '';
  const shouldShowDescriptionTooltip = !compact && description.trim().length > 69;

  const handleClick = () => {
    // Fire-and-forget access tracking. For mode='redirect' and
    // mode='entra-app' the server already logs via the dedicated redirect
    // endpoint, so we skip the explicit track call to avoid duplicate rows.
    // For redirect-plain / internal-link / shared-cookie modes the browser goes directly to
    // target_url with no server round-trip, so this is the only signal the
    // server gets. Errors are swallowed — tracking must not block navigation.
    if (app.mode !== 'redirect' && app.mode !== 'entra-app') {
      api.post(`/apps/${app.slug}/track-access`).catch(() => {});
    }
    window.open(app.url, '_blank', 'noopener');
  };

  const handleInfo = (e) => {
    e.stopPropagation();
    setShowInfo(true);
  };

  const handleFavorite = (e) => {
    e.stopPropagation();
    onToggleFavorite?.(app.id);
  };

  const getLabel = (key, ...args) => {
    const value = labels?.[key];
    return typeof value === 'function' ? value(...args) : value;
  };

  if (compact) {
    return (
      <>
        <div
          ref={ref}
          onClick={handleClick}
          className={`group flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl px-4 py-2.5 border border-gray-100 dark:border-gray-800 hover:border-accent hover:shadow-md hover:shadow-accent/10 transition-all duration-150 cursor-pointer ${
            tourHighlight ? 'relative z-20 scale-[1.01]' : ''
          }`}
        >
          <Tooltip content={getLabel('openAppNamed', app.name)}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              className="shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40"
              aria-label={getLabel('openAppNamed', app.name)}
            >
              <AppIcon app={app} className="w-8 h-8" textClassName="text-xl" alt={app.name} />
            </button>
          </Tooltip>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-dark dark:text-gray-100 truncate group-hover:text-dark/80 dark:group-hover:text-gray-200 transition-colors">
                {app.name}
              </span>
            </div>
            {description && (
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {description}
              </p>
            )}
          </div>

          {tags.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 shrink-0">
              {tags.slice(0, 2).map((tag, i) => (
                <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-200 bg-purple-100 dark:bg-purple-900/40 px-1.5 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
              {tags.length > 2 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">+{tags.length - 2}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {showModeBadges && isSharedCookie && (
              <span className="text-[10px] font-medium text-accent-dark bg-accent/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" />{labels?.ssoBadgeShort}
              </span>
            )}
            {showModeBadges && isEntraApp && (
              <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">{getLabel('entraBadgeShort')}</span>
            )}
            {showModeBadges && isExternal && (
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{getLabel('externalBadgeShort')}</span>
            )}
            {showModeBadges && isInternalLink && (
              <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 px-1.5 py-0.5 rounded">{getLabel('internalLinkBadgeShort')}</span>
            )}
            {hasLongDesc && (
              <Tooltip content={getLabel('appInfo')}>
                <button
                  ref={tourInfoRef}
                  onClick={handleInfo}
                  className="p-1 text-gray-300 dark:text-gray-600 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  aria-label={getLabel('appInfo')}
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            )}
            <Tooltip content={isFavorite ? getLabel('removeFavorite') : getLabel('addFavorite')}>
              <button
                ref={tourFavoriteRef}
                onClick={handleFavorite}
                className={`p-1 rounded-lg transition-colors ${
                  isFavorite
                    ? 'text-yellow-400 hover:text-yellow-500'
                    : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                aria-label={isFavorite ? getLabel('removeFavorite') : getLabel('addFavorite')}
              >
                <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
            </Tooltip>
          </div>
        </div>

        {showInfo && <InfoModal app={app} onClose={() => setShowInfo(false)} labels={labels} />}
      </>
    );
  }

  return (
    <>
      <div
        ref={ref}
        style={style}
        className={`group bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 hover:border-accent hover:shadow-lg hover:shadow-accent/10 transition-all duration-200 text-left w-full relative ${
          tourHighlight ? 'z-20 scale-[1.01]' : ''
        } ${
          dragging ? 'shadow-xl ring-2 ring-accent/30 opacity-80 z-10' : ''
        }`}
      >
        {dragHandleProps && (
          <Tooltip content={getLabel('dragToReorder')}>
            <button
              type="button"
              ref={tourDragHandleRef}
              {...dragHandleProps}
              className={`absolute top-2 left-2 z-30 p-1 text-gray-300 dark:text-gray-600 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-opacity cursor-grab active:cursor-grabbing touch-none ${
                tourShowDragHandle ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              aria-label={getLabel('dragToReorder')}
            >
              <GripVertical className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        <div className="flex items-start justify-between mb-4">
          <Tooltip content={getLabel('openAppNamed', app.name)}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
              className="shrink-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/40"
              aria-label={getLabel('openAppNamed', app.name)}
            >
              <AppIcon app={app} className="w-12 h-12" textClassName="text-4xl" alt={app.name} />
            </button>
          </Tooltip>
          <div className="flex items-center gap-1">
            <Tooltip content={isFavorite ? getLabel('removeFavorite') : getLabel('addFavorite')}>
              <button
                ref={tourFavoriteRef}
                onClick={handleFavorite}
                className={`p-1.5 rounded-lg transition-colors ${
                  isFavorite
                    ? 'text-yellow-400 hover:text-yellow-500'
                    : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                aria-label={isFavorite ? getLabel('removeFavorite') : getLabel('addFavorite')}
              >
                <Star className="w-4 h-4" fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
            </Tooltip>
            {hasLongDesc && (
              <Tooltip content={getLabel('appInfo')}>
                <button
                  ref={tourInfoRef}
                  onClick={handleInfo}
                  className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  aria-label={getLabel('appInfo')}
                >
                  <Info className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            {showModeBadges && isSharedCookie && (
              <span className="text-[10px] font-medium text-accent-dark bg-accent/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" />{labels?.ssoBadgeShort}
              </span>
            )}
            {showModeBadges && isEntraApp && (
              <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">{getLabel('entraBadgeShort')}</span>
            )}
            {showModeBadges && isExternal && (
              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{getLabel('externalBadgeShort')}</span>
            )}
            {showModeBadges && isInternalLink && (
              <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 px-1.5 py-0.5 rounded">{getLabel('internalLinkBadgeShort')}</span>
            )}
          </div>
        </div>
        <button onClick={handleClick} className="w-full text-left cursor-pointer">
          <h3 className="text-lg font-bold text-dark dark:text-gray-100 mb-1.5 group-hover:text-dark/80 dark:group-hover:text-gray-200 transition-colors">
            {app.name}
          </h3>
          {description && shouldShowDescriptionTooltip ? (
            <Tooltip
              content={description}
              tooltipClassName="text-left max-w-[min(36rem,calc(100vw-2rem))]"
            >
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
                {description}
              </p>
            </Tooltip>
          ) : (
            description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
                {description}
              </p>
            )
          )}
        </button>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {tags.map((tag, i) => (
              <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-200 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {showInfo && <InfoModal app={app} onClose={() => setShowInfo(false)} labels={labels} />}
    </>
  );
});

function InfoModal({ app, onClose, labels = {} }) {
  const sanitizedLongDescription = DOMPurify.sanitize(app.long_description || '', {
    ADD_ATTR: ['target', 'rel'],
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <AppIcon app={app} className="w-10 h-10" textClassName="text-3xl" />
            <h2 className="text-xl font-bold text-dark dark:text-gray-100">{app.name}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={labels.closeDialog}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div
          className="prose prose-sm max-w-none text-gray-600 dark:text-gray-300 [&_a]:text-accent-dark [&_a]:underline [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_img]:rounded-lg [&_img]:max-w-full"
          dangerouslySetInnerHTML={{ __html: sanitizedLongDescription }}
        />
        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => { onClose(); window.open(app.url, '_blank', 'noopener'); }}
            className="w-full py-3 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors"
          >
            {typeof labels.openAppNamed === 'function' ? labels.openAppNamed(app.name) : app.name}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppCard;
