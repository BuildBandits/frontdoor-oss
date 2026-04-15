import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, X, Star, LayoutGrid, List, AlignJustify } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import api from '../services/api';
import AppCard from '../components/AppCard';
import SortableAppCard from '../components/SortableAppCard';
import TagGroupCard from '../components/TagGroupCard';

const LS_FAVORITES = 'frontdoor_favorites';
const LS_SHOW_FAVORITES = 'frontdoor_show_favorites';
const LS_GROUP_BY_TAG = 'frontdoor_group_by_tag';
const LS_COMPACT_VIEW = 'frontdoor_compact_view';
const LS_COMPACT_VIEW_VERSION = 'frontdoor_compact_view_version';
const LS_APP_ORDER = 'frontdoor_app_order';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTag(tag) {
  return (tag ?? '').toString().trim().toLowerCase();
}

function readNullableJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function readString(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function Home() {
  const [apps, setApps] = useState([]);
  const [branding, setBranding] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [brandingLoading, setBrandingLoading] = useState(true);

  // Persisted preferences
  const [favorites, setFavorites] = useState(() => readJson(LS_FAVORITES, []));
  const [showFavorites, setShowFavorites] = useState(() => readJson(LS_SHOW_FAVORITES, false));
  const [groupByTag, setGroupByTag] = useState(() => readJson(LS_GROUP_BY_TAG, false));
  const [compactViewOverride, setCompactViewOverride] = useState(() => readNullableJson(LS_COMPACT_VIEW));
  const [appOrder, setAppOrder] = useState(() => readJson(LS_APP_ORDER, []));

  // Tag groups open/close state
  const [openGroups, setOpenGroups] = useState({});

  useEffect(() => {
    api.get('/apps').then((res) => {
      setApps(res.data.apps);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get('/branding')
      .then((res) => setBranding(res.data.branding))
      .catch(() => setBranding(null))
      .finally(() => setBrandingLoading(false));
  }, []);

  useEffect(() => {
    if (!branding?.updatedAt) return;
    const savedVersion = readString(LS_COMPACT_VIEW_VERSION);
    if (savedVersion && savedVersion !== branding.updatedAt) {
      setCompactViewOverride(null);
      localStorage.removeItem(LS_COMPACT_VIEW);
      localStorage.removeItem(LS_COMPACT_VIEW_VERSION);
    }
  }, [branding?.updatedAt]);

  // Persist to localStorage
  useEffect(() => { localStorage.setItem(LS_FAVORITES, JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem(LS_SHOW_FAVORITES, JSON.stringify(showFavorites)); }, [showFavorites]);
  useEffect(() => { localStorage.setItem(LS_GROUP_BY_TAG, JSON.stringify(groupByTag)); }, [groupByTag]);
  useEffect(() => { localStorage.setItem(LS_APP_ORDER, JSON.stringify(appOrder)); }, [appOrder]);
  useEffect(() => {
    if (compactViewOverride !== null) {
      localStorage.setItem(LS_COMPACT_VIEW, JSON.stringify(compactViewOverride));
      if (branding?.updatedAt) {
        localStorage.setItem(LS_COMPACT_VIEW_VERSION, branding.updatedAt);
      }
    }
  }, [compactViewOverride, branding?.updatedAt]);

  const toggleFavorite = useCallback((appId) => {
    setFavorites((prev) =>
      prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId]
    );
  }, []);

  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  const sortedApps = useMemo(() => {
    if (apps.length === 0) return apps;
    const orderIndex = new Map(appOrder.map((id, i) => [id, i]));
    const fallbackBase = appOrder.length;
    return [...apps].sort((a, b) => {
      const aFav = favoritesSet.has(a.id) ? 0 : 1;
      const bFav = favoritesSet.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      const aIdx = orderIndex.has(a.id) ? orderIndex.get(a.id) : fallbackBase;
      const bIdx = orderIndex.has(b.id) ? orderIndex.get(b.id) : fallbackBase;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return 0;
    });
  }, [apps, favoritesSet, appOrder]);

  const allTags = useMemo(() => {
    const tagSet = new Set();
    sortedApps.forEach((app) => {
      (Array.isArray(app.tags) ? app.tags : []).forEach((t) => {
        const normalized = normalizeTag(t);
        if (normalized) tagSet.add(normalized);
      });
    });
    return [...tagSet].sort();
  }, [sortedApps]);

  const toggleTag = (tag) => {
    const nextTag = normalizeTag(tag);
    setSelectedTags((prev) =>
      prev.includes(nextTag) ? prev.filter((t) => t !== nextTag) : [...prev, nextTag]
    );
  };

  const filtered = useMemo(() => {
    return sortedApps.filter((app) => {
      if (showFavorites && !favoritesSet.has(app.id)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesText =
          app.name.toLowerCase().includes(q) ||
          app.description?.toLowerCase().includes(q) ||
          (Array.isArray(app.tags) && app.tags.some((t) => normalizeTag(t).includes(q)));
        if (!matchesText) return false;
      }
      if (selectedTags.length > 0) {
        const appTags = new Set((Array.isArray(app.tags) ? app.tags : []).map(normalizeTag));
        if (!selectedTags.some((t) => appTags.has(normalizeTag(t)))) return false;
      }
      return true;
    });
  }, [sortedApps, search, selectedTags, showFavorites, favoritesSet]);

  const groupedByTag = useMemo(() => {
    if (!groupByTag) return null;
    const groups = {};
    const noTag = [];
    filtered.forEach((app) => {
      const appTags = Array.isArray(app.tags) ? app.tags : [];
      if (appTags.length === 0) {
        noTag.push(app);
      } else {
        const normalizedTags = [...new Set(appTags.map(normalizeTag).filter(Boolean))];
        normalizedTags.forEach((tag) => {
          if (!groups[tag]) groups[tag] = [];
          groups[tag].push(app);
        });
      }
    });
    const sorted = Object.keys(groups).sort().map((tag) => ({
      tag,
      apps: groups[tag],
    }));
    if (noTag.length > 0) {
      sorted.push({ tag: 'Altro', apps: noTag });
    }
    return sorted;
  }, [filtered, groupByTag]);

  const toggleGroup = (tag) => {
    setOpenGroups((prev) => ({ ...prev, [tag]: !prev[tag] }));
  };

  const showModeBadges = branding?.showAppModeBadges !== false;
  const compactView = compactViewOverride ?? branding?.defaultCompactView ?? false;

  const filtersActive = search.trim().length > 0 || selectedTags.length > 0;
  const dragEnabled = !groupByTag && !filtersActive && !compactView;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeIsFav = favoritesSet.has(active.id);
      const overIsFav = favoritesSet.has(over.id);
      if (activeIsFav !== overIsFav) return;

      setAppOrder((prev) => {
        const base = prev.length > 0 ? prev.slice() : sortedApps.map((a) => a.id);
        for (const id of [active.id, over.id]) {
          if (!base.includes(id)) base.push(id);
        }
        const oldIndex = base.indexOf(active.id);
        const newIndex = base.indexOf(over.id);
        return arrayMove(base, oldIndex, newIndex);
      });
    },
    [favoritesSet, sortedApps]
  );

  const renderAppGrid = (appList) => {
    if (compactView) {
      return (
        <div className="flex flex-col gap-1.5">
          {appList.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              isFavorite={favoritesSet.has(app.id)}
              onToggleFavorite={toggleFavorite}
              showModeBadges={showModeBadges}
              compact
            />
          ))}
        </div>
      );
    }

    if (!dragEnabled) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {appList.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              isFavorite={favoritesSet.has(app.id)}
              onToggleFavorite={toggleFavorite}
              showModeBadges={showModeBadges}
            />
          ))}
        </div>
      );
    }

    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={appList.map((a) => a.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {appList.map((app) => (
              <SortableAppCard
                key={app.id}
                app={app}
                isFavorite={favoritesSet.has(app.id)}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    );
  };

  const commitSha = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'dev';

  return (
    <div>
      {/* Hero section */}
      <div className="bg-gradient-to-br from-accent/30 via-accent/10 to-transparent rounded-3xl p-8 md:p-12 mb-10 overflow-hidden">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <h1 className="text-3xl md:text-5xl font-extrabold text-dark leading-tight mb-4">
              {brandingLoading || !branding ? (
                <>
                  Le tue applicazioni,<br />
                  <span className="text-dark/70">tutte in un unico posto.</span>
                </>
              ) : (
                <>
                  {branding.heroTitleLine1}<br />
                  <span className="text-dark/70">{branding.heroTitleLine2}</span>
                </>
              )}
            </h1>
            {/*
              Sottotitolo temporaneamente lasciato come branding amministrabile.
              Se in futuro vogliamo semplificarlo ulteriormente, lo possiamo riattivare da Personalizza.
            */}
            <p className="text-gray-600 text-lg max-w-xl">
              {brandingLoading || !branding ? (
                'Accedi rapidamente a tutti gli strumenti e le piattaforme del tuo workspace.'
              ) : (
                branding.heroSubtitle
              )}
            </p>
          </div>

          {branding?.logoUrl && (
            <div className="hidden md:flex items-center justify-center px-2 py-2 min-h-[160px] min-w-[240px]">
              <img
                src={branding.logoUrl}
                alt="Company logo"
                className="max-h-24 max-w-[240px] object-contain"
              />
            </div>
          )}
        </div>
      </div>

      {/* Search + toggles + tag filters */}
      <div className="mb-8 space-y-3">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Cerca un'applicazione..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
            />
          </div>

          <button
            onClick={() => setShowFavorites((v) => !v)}
            className={`flex items-center gap-1.5 px-4 py-3.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap ${
              showFavorites
                ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
            title={showFavorites ? 'Mostra tutte' : 'Solo preferiti'}
          >
            <Star className="w-4 h-4" fill={showFavorites ? 'currentColor' : 'none'} />
            <span className="hidden sm:inline">Preferiti</span>
          </button>

          <button
            onClick={() => setGroupByTag((v) => !v)}
            className={`flex items-center gap-1.5 px-4 py-3.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap ${
              groupByTag
                ? 'bg-purple-50 border-purple-300 text-purple-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
            title={groupByTag ? 'Vista griglia' : 'Raggruppa per tag'}
          >
            {groupByTag ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
            <span className="hidden sm:inline">Raggruppa</span>
          </button>

          <button
            onClick={() => {
              const next = !(compactViewOverride ?? (branding?.defaultCompactView ?? false));
              setCompactViewOverride(next);
              if (branding?.updatedAt) {
                localStorage.setItem(LS_COMPACT_VIEW_VERSION, branding.updatedAt);
              }
            }}
            className={`flex items-center gap-1.5 px-4 py-3.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap ${
              compactView
                ? 'bg-gray-900 border-gray-900 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
            title={compactView ? 'Vista card' : 'Vista compatta'}
          >
            <AlignJustify className="w-4 h-4" />
            <span className="hidden sm:inline">Compatta</span>
          </button>
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors ${
                    active
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  {tag}
                  {active && <X className="w-3 h-3" />}
                </button>
              );
            })}
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
              >
                Tutti
              </button>
            )}
          </div>
        )}
      </div>

      {/* App grid */}
      {loading ? (
        compactView ? (
          <div className="flex flex-col gap-1.5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-12 bg-white rounded-xl animate-pulse border border-gray-100" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 h-48 animate-pulse border border-gray-100" />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-xl font-semibold mb-2">
            {showFavorites ? 'Nessun preferito trovato' : 'Nessuna app trovata'}
          </p>
          <p>
            {showFavorites
              ? 'Aggiungi app ai preferiti cliccando la stellina'
              : 'Prova a cercare con un altro termine'}
          </p>
        </div>
      ) : groupByTag && groupedByTag ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {groupedByTag.map(({ tag, apps: groupApps }) => (
              <TagGroupCard
                key={tag}
                tag={tag}
                count={groupApps.length}
                isOpen={!!openGroups[tag]}
                onToggle={() => toggleGroup(tag)}
              />
            ))}
          </div>

          {groupedByTag
            .filter(({ tag }) => openGroups[tag])
            .map(({ tag, apps: groupApps }) => (
              <div key={tag} className="mt-2">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                {renderAppGrid(groupApps)}
              </div>
            ))}
        </div>
      ) : (
        renderAppGrid(filtered)
      )}

      <div className="mt-16 text-center text-xs text-gray-400 font-mono select-all">
        v{commitSha}
      </div>
    </div>
  );
}
