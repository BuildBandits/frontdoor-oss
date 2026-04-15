import { forwardRef, useState } from 'react';
import { ExternalLink, Info, X, Lock, Star, GripVertical } from 'lucide-react';
import DOMPurify from 'dompurify';
import AppIcon from './AppIcon';

const AppCard = forwardRef(function AppCard(
  { app, isFavorite, onToggleFavorite, showModeBadges = true, compact = false, dragHandleProps, dragging, style },
  ref
) {
  const [showInfo, setShowInfo] = useState(false);
  const isExternal = app.mode === 'redirect' || app.mode === 'redirect-plain';
  const isSharedCookie = app.mode === 'shared-cookie';
  const isEntraApp = app.mode === 'entra-app';
  const hasLongDesc = app.long_description?.trim();
  const tags = Array.isArray(app.tags) ? app.tags : [];

  const handleClick = () => {
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

  if (compact) {
    return (
      <>
        <div
          onClick={handleClick}
          className="group flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 border border-gray-100 hover:border-accent hover:shadow-md hover:shadow-accent/10 transition-all duration-150 cursor-pointer"
        >
          <AppIcon app={app} className="w-8 h-8 shrink-0" textClassName="text-xl" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-dark truncate group-hover:text-dark/80 transition-colors">
                {app.name}
              </span>
              <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-accent-dark transition-colors shrink-0" />
            </div>
            {app.description && (
              <p className="text-xs text-gray-400 truncate">{app.description}</p>
            )}
          </div>

          {tags.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 shrink-0">
              {tags.slice(0, 2).map((tag, i) => (
                <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
              {tags.length > 2 && (
                <span className="text-[10px] text-gray-400">+{tags.length - 2}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {showModeBadges && isSharedCookie && (
              <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" />SSO
              </span>
            )}
            {showModeBadges && isEntraApp && (
              <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">entra</span>
            )}
            {showModeBadges && isExternal && (
              <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">ext</span>
            )}
            {hasLongDesc && (
              <button
                onClick={handleInfo}
                className="p-1 text-gray-300 hover:text-dark hover:bg-gray-100 rounded-lg transition-colors"
                title="Informazioni"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={handleFavorite}
              className={`p-1 rounded-lg transition-colors ${
                isFavorite
                  ? 'text-yellow-400 hover:text-yellow-500'
                  : 'text-gray-300 hover:text-yellow-400 hover:bg-gray-100'
              }`}
              title={isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            >
              <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>

        {showInfo && <InfoModal app={app} onClose={() => setShowInfo(false)} />}
      </>
    );
  }

  return (
    <>
      <div
        ref={ref}
        style={style}
        className={`group bg-white rounded-2xl p-6 border border-gray-100 hover:border-accent hover:shadow-lg hover:shadow-accent/10 transition-all duration-200 text-left w-full relative ${
          dragging ? 'shadow-xl ring-2 ring-accent/30 opacity-80 z-10' : ''
        }`}
      >
        {dragHandleProps && (
          <button
            type="button"
            {...dragHandleProps}
            className="absolute top-2 left-2 p-1 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-dark hover:bg-gray-100 rounded transition-opacity cursor-grab active:cursor-grabbing touch-none"
            title="Trascina per riordinare"
            aria-label="Trascina per riordinare"
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-start justify-between mb-4">
          <AppIcon app={app} className="w-12 h-12" textClassName="text-4xl" />
          <div className="flex items-center gap-1">
            <button
              onClick={handleFavorite}
              className={`p-1.5 rounded-lg transition-colors ${
                isFavorite
                  ? 'text-yellow-400 hover:text-yellow-500'
                  : 'text-gray-300 hover:text-yellow-400 hover:bg-gray-100'
              }`}
              title={isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            >
              <Star className="w-4 h-4" fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            {hasLongDesc && (
              <button
                onClick={handleInfo}
                className="p-1.5 text-gray-300 hover:text-dark hover:bg-gray-100 rounded-lg transition-colors"
                title="Informazioni"
              >
                <Info className="w-4 h-4" />
              </button>
            )}
            {showModeBadges && isSharedCookie && (
              <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" />SSO
              </span>
            )}
            {showModeBadges && isEntraApp && (
              <span className="text-[10px] font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">entra</span>
            )}
            {showModeBadges && isExternal && (
              <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">ext</span>
            )}
          </div>
        </div>
        <button onClick={handleClick} className="w-full text-left cursor-pointer">
          <h3 className="text-lg font-bold text-dark mb-1.5 group-hover:text-dark/80 transition-colors flex items-center gap-2">
            {app.name}
            <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-accent-dark transition-colors shrink-0" />
          </h3>
          <p className="text-sm text-gray-500 leading-relaxed line-clamp-2">
            {app.description}
          </p>
        </button>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {tags.map((tag, i) => (
              <span key={i} className="text-[10px] font-semibold uppercase tracking-wider text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {showInfo && <InfoModal app={app} onClose={() => setShowInfo(false)} />}
    </>
  );
});

function InfoModal({ app, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <AppIcon app={app} className="w-10 h-10" textClassName="text-3xl" />
            <h2 className="text-xl font-bold text-dark">{app.name}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div
          className="prose prose-sm max-w-none text-gray-600 [&_a]:text-accent-dark [&_a]:underline [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_img]:rounded-lg [&_img]:max-w-full"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(app.long_description) }}
        />
        <div className="mt-6 pt-4 border-t border-gray-100">
          <button
            onClick={() => { onClose(); window.open(app.url, '_blank', 'noopener'); }}
            className="w-full py-3 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors"
          >
            Apri {app.name}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppCard;
