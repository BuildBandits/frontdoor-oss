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
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';

const LS_FAVORITES = 'frontdoor_favorites';
const LS_SHOW_FAVORITES = 'frontdoor_show_favorites';
const LS_GROUP_BY_TAG = 'frontdoor_group_by_tag';

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

export default function Home() {
  const { user, updateHomeDesktopView, updateAppOrder } = useAuthStore();
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
  const [isMobileViewport, setIsMobileViewport] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  ));

  // Tag groups open/close state
  const [openGroups, setOpenGroups] = useState({});
  const language = resolveAppLanguage(user?.preferredLanguage, branding?.defaultLanguage);
  const ui = getUiStrings(language);

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
    const onBrandingUpdated = (event) => {
      if (event.detail) {
        setBranding(event.detail);
      }
    };
    window.addEventListener('frontdoor:branding-updated', onBrandingUpdated);
    return () => window.removeEventListener('frontdoor:branding-updated', onBrandingUpdated);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', updateViewport);
      return () => mediaQuery.removeEventListener('change', updateViewport);
    }

    mediaQuery.addListener(updateViewport);
    return () => mediaQuery.removeListener(updateViewport);
  }, []);

  // Persist to localStorage
  useEffect(() => { localStorage.setItem(LS_FAVORITES, JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem(LS_SHOW_FAVORITES, JSON.stringify(showFavorites)); }, [showFavorites]);
  useEffect(() => { localStorage.setItem(LS_GROUP_BY_TAG, JSON.stringify(groupByTag)); }, [groupByTag]);

  const toggleFavorite = useCallback((appId) => {
    setFavorites((prev) =>
      prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId]
    );
  }, []);

  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);
  const appOrder = Array.isArray(user?.appOrder) && user.appOrder.length > 0 ? user.appOrder : null;

  const sortedApps = useMemo(() => {
    if (apps.length === 0) return apps;
    if (!appOrder) {
        return [...apps].sort((a, b) => {
        const aFav = favoritesSet.has(a.id) ? 0 : 1;
        const bFav = favoritesSet.has(b.id) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        const aSort = Number.isFinite(a.sort_order) ? a.sort_order : 0;
        const bSort = Number.isFinite(b.sort_order) ? b.sort_order : 0;
        if (aSort !== bSort) return aSort - bSort;
        return a.name.localeCompare(b.name, language === 'it' ? 'it' : 'en', { sensitivity: 'base' });
      });
    }
    const orderIndex = new Map(appOrder.map((id, i) => [id, i]));
    const fallbackBase = appOrder.length;
    return [...apps].sort((a, b) => {
      const aFav = favoritesSet.has(a.id) ? 0 : 1;
      const bFav = favoritesSet.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      const aIdx = orderIndex.has(a.id) ? orderIndex.get(a.id) : fallbackBase;
      const bIdx = orderIndex.has(b.id) ? orderIndex.get(b.id) : fallbackBase;
      if (aIdx !== bIdx) return aIdx - bIdx;
      const aSort = Number.isFinite(a.sort_order) ? a.sort_order : 0;
      const bSort = Number.isFinite(b.sort_order) ? b.sort_order : 0;
      if (aSort !== bSort) return aSort - bSort;
      return a.name.localeCompare(b.name, language === 'it' ? 'it' : 'en', { sensitivity: 'base' });
    });
  }, [apps, favoritesSet, appOrder, language]);

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
      sorted.push({ tag: ui.home.otherTagGroup, apps: noTag });
    }
    return sorted;
  }, [filtered, groupByTag, ui.home.otherTagGroup]);

  const toggleGroup = (tag) => {
    setOpenGroups((prev) => ({ ...prev, [tag]: !prev[tag] }));
  };

  const showModeBadges = branding?.showAppModeBadges !== false;
  const mobileCompactViewForced = isMobileViewport && branding?.defaultCompactView === true;
  const desktopCompactViewPreferred = user?.homeDesktopView ?? (branding?.defaultHomeDesktopView === 'compact' ? 'compact' : 'cards');
  const compactView = mobileCompactViewForced ? true : desktopCompactViewPreferred === 'compact';
  const hideHeroOnMobile = isMobileViewport && branding?.hideHomeHeroOnMobile === true;
  const showHero = branding?.showHomeHero !== false && !hideHeroOnMobile;
  const appCardLabels = useMemo(() => ({
    openAppNamed: (name) => ui.home.openAppNamed.replace('{name}', name),
    appInfo: ui.home.appInfo,
    addFavorite: ui.home.addFavorite,
    removeFavorite: ui.home.removeFavorite,
    dragToReorder: ui.home.dragToReorder,
    closeDialog: ui.common.closeDialog,
    entraBadgeShort: ui.home.entraBadgeShort,
    externalBadgeShort: ui.home.externalBadgeShort,
  }), [ui]);

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

      const base = appOrder ? appOrder.slice() : sortedApps.map((a) => a.id);
      for (const id of [active.id, over.id]) {
        if (!base.includes(id)) base.push(id);
      }
      const oldIndex = base.indexOf(active.id);
      const newIndex = base.indexOf(over.id);
      const next = arrayMove(base, oldIndex, newIndex);
      void updateAppOrder(next);
    },
    [appOrder, favoritesSet, sortedApps, updateAppOrder]
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
              labels={appCardLabels}
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
              labels={appCardLabels}
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
                showModeBadges={showModeBadges}
                labels={appCardLabels}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    );
  };

  return (
    <div>
      {/* Hero section */}
      {showHero && (
        <div className="bg-gradient-to-br from-accent/30 via-accent/10 to-transparent rounded-3xl p-6 md:p-8 mb-8 overflow-hidden">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <h1 className="text-2xl md:text-4xl font-extrabold text-dark leading-tight mb-3">
                {brandingLoading || !branding ? (
                  <>
                    {ui.home.heroTitleLine1}<br />
                    <span className="text-dark/70">{ui.home.heroTitleLine2}</span>
                  </>
                ) : (
                  <>
                    {branding.heroTitleLine1}<br />
                    <span className="text-dark/70">{branding.heroTitleLine2}</span>
                  </>
                )}
              </h1>
              {/* Sottotitolo temporaneamente lasciato come branding amministrabile. */}
              <p className="text-gray-600 text-base md:text-lg max-w-xl">
                {brandingLoading || !branding ? (
                  ui.home.heroSubtitle
                ) : (
                  branding.heroSubtitle
                )}
              </p>
            </div>

            {branding?.logoUrl && (
              <div className="hidden md:flex items-center justify-center px-2 py-2 min-h-[120px] min-w-[200px]">
                <img
                  src={branding.logoUrl}
                  alt={ui.home.companyLogoAlt}
                  className="max-h-20 max-w-[220px] object-contain"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search + toggles + tag filters */}
      <div className="mb-8 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder={ui.home.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
            />
          </div>

            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-nowrap sm:gap-3 sm:shrink-0">
          <button
            onClick={() => setShowFavorites((v) => !v)}
            className={`flex items-center justify-center gap-1.5 px-3 py-3.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap sm:flex-none ${
              showFavorites
                ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
            title={showFavorites ? ui.home.showAll : ui.home.favoritesTitle}
          >
            <Star className="w-4 h-4" fill={showFavorites ? 'currentColor' : 'none'} />
            <span className="hidden sm:inline">{ui.home.favorites}</span>
          </button>

          <button
            onClick={() => setGroupByTag((v) => !v)}
            className={`flex items-center justify-center gap-1.5 px-3 py-3.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap sm:flex-none ${
              groupByTag
                ? 'bg-purple-50 border-purple-300 text-purple-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
            title={groupByTag ? ui.home.gridViewTitle : ui.home.groupByTitle}
          >
            {groupByTag ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
            <span className="hidden sm:inline">{ui.home.groupBy}</span>
          </button>

          <button
            onClick={async () => {
              if (mobileCompactViewForced) return;
              const next = compactView ? 'cards' : 'compact';
              try {
                await updateHomeDesktopView(next);
              } catch {
                // Leave the current view unchanged if the save fails.
              }
            }}
            disabled={mobileCompactViewForced}
            className={`flex items-center justify-center gap-1.5 px-3 py-3.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap sm:flex-none ${
              compactView
                ? 'bg-gray-900 border-gray-900 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            } ${mobileCompactViewForced ? 'opacity-70 cursor-not-allowed' : ''}`}
            title={mobileCompactViewForced ? ui.home.compactViewForcedTitle : (compactView ? ui.home.cardsLabel : ui.home.compactViewTitle)}
          >
            <AlignJustify className="w-4 h-4" />
            <span className="hidden sm:inline">{mobileCompactViewForced ? ui.home.compactMobileLabel : ui.home.compactLabel}</span>
          </button>
          </div>
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
                {ui.home.allTags}
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
            {showFavorites ? ui.home.favoritesEmptyTitle : ui.home.appsEmptyTitle}
          </p>
          <p>
            {showFavorites
              ? ui.home.favoritesEmptyBody
              : ui.home.appsEmptyBody}
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
    </div>
  );
}
