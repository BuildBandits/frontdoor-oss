import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Star, LayoutGrid, List, Rows3, AppWindow } from 'lucide-react';
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
import ClearableSearchField from '../components/ClearableSearchField';
import { useAuthStore } from '../stores/authStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';
import {
  HOME_TOUR_REPLAY_EVENT,
  requestHomeTourAccountMenuClose,
  requestHomeTourAccountMenuOpen,
} from '../utils/homeTour';
import { getBrowserHomepageDocs } from '../utils/browserHomeDocs';

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
  const {
    user,
    updateHomeDesktopView,
    updateAppOrder,
    markHomeTourSeen,
  } = useAuthStore();
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
  const [tourOpen, setTourOpen] = useState(false);
  const [tourDismissed, setTourDismissed] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [spotlightRects, setSpotlightRects] = useState([]);
  const spotlightMaskId = 'home-tour-spotlight-mask';
  const heroRef = useRef(null);
  const controlsRef = useRef(null);
  const catalogRef = useRef(null);
  const featuredAppRef = useRef(null);
  const featuredFavoriteRef = useRef(null);
  const featuredInfoRef = useRef(null);
  const featuredDragHandleRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const language = resolveAppLanguage(user?.preferredLanguage, branding?.defaultLanguage);
  const ui = getUiStrings(language);
  const showModeBadges = branding?.showAppModeBadges !== false;
  const mobileCompactViewForced = isMobileViewport && branding?.defaultCompactView === true;
  const desktopCompactViewPreferred = user?.homeDesktopView ?? (branding?.defaultHomeDesktopView === 'compact' ? 'compact' : 'cards');
  const compactView = mobileCompactViewForced ? true : desktopCompactViewPreferred === 'compact';
  const hideHeroOnMobile = isMobileViewport && branding?.hideHomeHeroOnMobile === true;
  const showHero = branding?.showHomeHero !== false && !hideHeroOnMobile;
  const languageReady = !brandingLoading;
  const browserHomepageDocs = useMemo(
    () => getBrowserHomepageDocs(typeof navigator !== 'undefined' ? navigator.userAgent : '', language),
    [language]
  );
  const tourSteps = useMemo(() => {
    const steps = [
      {
        key: 'welcome',
        targetRef: null,
        placement: 'center',
        title: ui.home.tour.steps.welcome.title,
        body: ui.home.tour.steps.welcome.body,
      },
      {
        key: 'search',
        targetRef: controlsRef,
        title: ui.home.tour.steps.search.title,
        body: ui.home.tour.steps.search.body,
      },
      {
        key: 'catalog',
        targetRef: catalogRef,
        title: ui.home.tour.steps.catalog.title,
        body: ui.home.tour.steps.catalog.body,
      },
      {
        key: 'appCards',
        targetRef: featuredAppRef,
        title: ui.home.tour.steps.appCards.title,
        body: ui.home.tour.steps.appCards.body,
        spotlightRefs: [featuredFavoriteRef, featuredInfoRef],
      },
      {
        key: 'reorder',
        targetRef: featuredAppRef,
        title: ui.home.tour.steps.reorder.title,
        body: ui.home.tour.steps.reorder.body,
        spotlightRefs: [featuredDragHandleRef],
      },
      {
        key: 'menu',
        targetRef: { current: null },
        title: ui.home.tour.steps.menu.title,
        body: ui.home.tour.steps.menu.body,
        openMenu: true,
      },
      {
        key: 'homepage',
        targetRef: null,
        placement: 'center',
        title: ui.home.tour.steps.homepage.title,
        body: ui.home.tour.steps.homepage.body,
        browserDocs: browserHomepageDocs,
      },
    ];
    return steps;
  }, [browserHomepageDocs, ui]);
  const currentTourStep = tourSteps[tourStep] || tourSteps[0];
  const totalTourSteps = tourSteps.length;
  const tourProgressLabel = ui.home.tour.progress
    .replace('{current}', String(tourStep + 1))
    .replace('{total}', String(totalTourSteps));

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

  const closeTour = useCallback(() => {
    setTourDismissed(true);
    setTourOpen(false);
    setSpotlightRects([]);
    void markHomeTourSeen?.();
  }, [markHomeTourSeen]);

  const openTour = useCallback(() => {
    setTourStep(0);
    setTourOpen(true);
  }, []);

  useEffect(() => {
    if (!user || !languageReady) return undefined;

    if (!user.homeTourSeenAt && !tourDismissed) {
      openTour();
    }

    return undefined;
  }, [user, languageReady, tourDismissed, openTour]);

  useEffect(() => {
    setTourDismissed(false);
  }, [user?.id]);

  useEffect(() => {
    const onReplay = () => {
      openTour();
    };
    window.addEventListener(HOME_TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(HOME_TOUR_REPLAY_EVENT, onReplay);
  }, [openTour]);

  useEffect(() => {
    if (!location.state?.replayHomeTour || !languageReady) return undefined;
    openTour();
    navigate(location.pathname, { replace: true, state: null });
    return undefined;
  }, [languageReady, location.pathname, location.state, navigate, openTour]);

  useEffect(() => {
    if (!tourOpen) return undefined;
    const target = currentTourStep?.targetRef?.current;
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return undefined;
  }, [currentTourStep, tourOpen, loading, apps.length]);

  useEffect(() => {
    if (!tourOpen) {
      requestHomeTourAccountMenuClose();
      return undefined;
    }

    if (currentTourStep?.key === 'menu') {
      requestHomeTourAccountMenuOpen();
    } else {
      requestHomeTourAccountMenuClose();
    }

    return undefined;
  }, [currentTourStep?.key, tourOpen]);

  useEffect(() => {
    if (!tourOpen) {
      setSpotlightRects([]);
      return undefined;
    }

    const getTargetElements = () => {
      if (currentTourStep?.key === 'menu') {
        return [document.getElementById('frontdoor-account-menu-panel')].filter(Boolean);
      }
      if (Array.isArray(currentTourStep?.spotlightRefs) && currentTourStep.spotlightRefs.length > 0) {
        return currentTourStep.spotlightRefs.map((ref) => ref?.current).filter(Boolean);
      }
      return currentTourStep?.targetRef?.current ? [currentTourStep.targetRef.current] : [];
    };

    const updateSpotlight = () => {
      const targets = getTargetElements();
      if (!targets.length) {
        setSpotlightRects([]);
        return;
      }
      const rects = targets.map((target) => {
        const rect = target.getBoundingClientRect();
        return {
          top: Math.max(rect.top - 16, 8),
          right: Math.max(rect.right + 16, 8),
          bottom: Math.max(rect.bottom + 16, 8),
          left: Math.max(rect.left - 16, 8),
          width: rect.width + 32,
          height: rect.height + 32,
        };
      });

      if (rects.length === 1) {
        setSpotlightRects(rects);
        return;
      }

      const combinedRect = rects.reduce((acc, rect) => ({
        top: Math.min(acc.top, rect.top),
        left: Math.min(acc.left, rect.left),
        right: Math.max(acc.right, rect.right),
        bottom: Math.max(acc.bottom, rect.bottom),
      }), {
        top: rects[0].top,
        left: rects[0].left,
        right: rects[0].right,
        bottom: rects[0].bottom,
      });

      setSpotlightRects([{
        top: combinedRect.top,
        left: combinedRect.left,
        right: combinedRect.right,
        bottom: combinedRect.bottom,
        width: combinedRect.right - combinedRect.left,
        height: combinedRect.bottom - combinedRect.top,
      }]);
    };

    const raf = window.requestAnimationFrame(() => {
      if (currentTourStep?.key === 'menu') {
        window.requestAnimationFrame(updateSpotlight);
        return;
      }
      updateSpotlight();
    });
    window.addEventListener('resize', updateSpotlight);
    window.addEventListener('scroll', updateSpotlight, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
    };
  }, [currentTourStep, tourOpen]);

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

  const launchApp = useCallback((app) => {
    if (!app || !app.url) return;
    if (app.mode !== 'redirect' && app.mode !== 'entra-app') {
      api.post(`/apps/${app.slug}/track-access`).catch(() => {});
    }
    window.open(app.url, '_blank', 'noopener');
  }, []);

  const handleSearchKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    if (!filtered || filtered.length === 0) return;
    event.preventDefault();
    launchApp(filtered[0]);
  };

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

  const appCardLabels = useMemo(() => ({
    openAppNamed: (name) => ui.home.openAppNamed.replace('{name}', name),
    appInfo: ui.home.appInfo,
    addFavorite: ui.home.addFavorite,
    removeFavorite: ui.home.removeFavorite,
    dragToReorder: ui.home.dragToReorder,
    closeDialog: ui.common.closeDialog,
    entraBadgeShort: ui.home.entraBadgeShort,
    externalBadgeShort: ui.home.externalBadgeShort,
    ssoBadgeShort: ui.home.ssoBadgeShort,
  }), [ui]);

  const filtersActive = search.trim().length > 0 || selectedTags.length > 0;
  const dragEnabled = !groupByTag && !filtersActive && !compactView;
  const appCountLabel = ui.home.appCount.replace('{count}', String(filtered.length));
  const tourStepIndex = tourStep;
  const isLastTourStep = tourStepIndex === totalTourSteps - 1;
  const isCenteredTourStep = currentTourStep?.placement === 'center';
  const tourBrowserDocs = currentTourStep?.browserDocs ?? [];

  const handleTourPrevious = () => {
    setTourStep((value) => Math.max(0, value - 1));
  };

  const handleTourNext = () => {
    if (tourStepIndex >= totalTourSteps - 1) {
      closeTour();
      return;
    }
    setTourStep((value) => Math.min(totalTourSteps - 1, value + 1));
  };

  useEffect(() => {
    if (!tourOpen) return undefined;

    const onKeyDown = (event) => {
      const activeElement = document.activeElement;
      const isTypingField = activeElement && (
        activeElement.tagName === 'INPUT'
        || activeElement.tagName === 'TEXTAREA'
        || activeElement.tagName === 'SELECT'
        || activeElement.isContentEditable
      );

      if (isTypingField) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleTourNext();
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleTourPrevious();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTourNext, handleTourPrevious, tourOpen]);

  const handleToggleGroupByTag = async () => {
    if (mobileCompactViewForced) return;

    if (groupByTag) {
      setGroupByTag(false);
      return;
    }

    if (compactView) {
      try {
        await updateHomeDesktopView('cards');
      } catch {
        return;
      }
    }

    setGroupByTag(true);
  };

  const handleToggleCompactView = async () => {
    if (mobileCompactViewForced) return;

    const next = compactView ? 'cards' : 'compact';
    const shouldDisableGrouping = !compactView && groupByTag;
    const restoreGrouping = shouldDisableGrouping ? groupByTag : false;

    if (shouldDisableGrouping) {
      setGroupByTag(false);
    }

    try {
      await updateHomeDesktopView(next);
    } catch {
      if (shouldDisableGrouping && restoreGrouping) {
        setGroupByTag(true);
      }
    }
  };

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

  const renderAppGrid = (appList, { canSpotlight = true } = {}) => {
    const spotlightTargetApp = canSpotlight && tourOpen && (tourStepIndex === 3 || tourStepIndex === 4)
      ? (
        tourStepIndex === 3
          ? (appList.find((app) => app.long_description?.trim()) || appList[0])
          : (appList[0] || null)
      )
      : null;
    const spotlightTargetId = spotlightTargetApp?.id ?? null;
    if (compactView) {
      return (
        <div className="flex flex-col gap-1.5">
          {appList.map((app) => (
            <AppCard
              key={app.id}
              ref={app.id === spotlightTargetId ? featuredAppRef : null}
              app={app}
              isFavorite={favoritesSet.has(app.id)}
              onToggleFavorite={toggleFavorite}
              showModeBadges={showModeBadges}
              compact
              tourHighlight={app.id === spotlightTargetId}
              tourShowDragHandle={tourOpen && tourStepIndex === 4 && app.id === spotlightTargetId}
              tourFavoriteRef={app.id === spotlightTargetId ? featuredFavoriteRef : null}
              tourInfoRef={app.id === spotlightTargetId ? featuredInfoRef : null}
              tourDragHandleRef={app.id === spotlightTargetId ? featuredDragHandleRef : null}
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
              ref={app.id === spotlightTargetId ? featuredAppRef : null}
              app={app}
              isFavorite={favoritesSet.has(app.id)}
              onToggleFavorite={toggleFavorite}
              showModeBadges={showModeBadges}
              tourHighlight={app.id === spotlightTargetId}
              tourShowDragHandle={tourOpen && tourStepIndex === 4 && app.id === spotlightTargetId}
              tourFavoriteRef={app.id === spotlightTargetId ? featuredFavoriteRef : null}
              tourInfoRef={app.id === spotlightTargetId ? featuredInfoRef : null}
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
                tourHighlight={app.id === spotlightTargetId}
                tourShowDragHandle={tourOpen && tourStepIndex === 4 && app.id === spotlightTargetId}
                tourFavoriteRef={app.id === spotlightTargetId ? featuredFavoriteRef : null}
                tourInfoRef={app.id === spotlightTargetId ? featuredInfoRef : null}
                tourDragHandleRef={app.id === spotlightTargetId ? featuredDragHandleRef : null}
                tourRef={app.id === spotlightTargetId ? featuredAppRef : null}
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
        <div
          ref={heroRef}
          className="bg-gradient-to-br from-accent/30 via-accent/10 to-transparent dark:from-accent/15 dark:via-accent/5 dark:to-transparent rounded-3xl p-6 md:p-8 mb-8 overflow-hidden transition-shadow"
        >
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <h1 className="text-2xl md:text-4xl font-extrabold text-dark dark:text-gray-100 leading-tight mb-3">
                {brandingLoading || !branding ? (
                  <>
                    {ui.home.heroTitleLine1}<br />
                    <span className="text-dark/70 dark:text-gray-300">{ui.home.heroTitleLine2}</span>
                  </>
                ) : (
                  <>
                    {branding.heroTitleLine1}<br />
                    <span className="text-dark/70 dark:text-gray-300">{branding.heroTitleLine2}</span>
                  </>
                )}
              </h1>
              {/* Sottotitolo temporaneamente lasciato come branding amministrabile. */}
              <p className="text-gray-600 dark:text-gray-300 text-base md:text-lg max-w-xl">
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
      <div
        ref={controlsRef}
        className="mb-8 space-y-3"
      >
        <div className="flex items-stretch gap-3 min-w-0 overflow-x-auto pb-1">
          <div className="flex min-w-0 h-14 flex-1 items-center gap-3 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4">
            <ClearableSearchField
              value={search}
              onChange={setSearch}
              placeholder={ui.home.searchPlaceholder}
              onKeyDown={handleSearchKeyDown}
              clearLabel={ui.common.clearSearch}
              tabIndex={1}
              className="flex-1 min-w-0"
              inputClassName="h-11 text-base"
            />

            <span className="text-sm font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {appCountLabel}
            </span>
          </div>
          <div className="flex shrink-0 items-stretch gap-2 sm:gap-3">
            <button
              onClick={() => setShowFavorites((v) => !v)}
              className={`flex h-14 items-center justify-center gap-1.5 px-3 rounded-xl border text-sm font-medium transition-all duration-150 active:translate-y-px active:scale-[0.99] whitespace-nowrap sm:flex-none ${
                showFavorites
                  ? 'bg-yellow-50 border-yellow-300 text-yellow-700 dark:bg-yellow-950/50 dark:border-yellow-600 dark:text-yellow-300'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700'
              }`}
              title={showFavorites ? ui.home.showAll : ui.home.favoritesTitle}
            >
              <Star className="w-4 h-4" fill={showFavorites ? 'currentColor' : 'none'} />
              <span className="hidden sm:inline">{ui.home.favorites}</span>
            </button>

            <button
              onClick={handleToggleGroupByTag}
              disabled={mobileCompactViewForced}
              className={`flex h-14 items-center justify-center gap-1.5 px-3 rounded-xl border text-sm font-medium transition-all duration-150 active:translate-y-px active:scale-[0.99] whitespace-nowrap sm:flex-none ${
                groupByTag
                  ? 'bg-purple-50 border-purple-300 text-purple-700 dark:bg-purple-950/50 dark:border-purple-600 dark:text-purple-300'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700'
              } ${mobileCompactViewForced ? 'opacity-70 cursor-not-allowed' : ''}`}
              title={groupByTag ? ui.home.gridViewTitle : ui.home.groupByTitle}
            >
              {groupByTag ? <AppWindow className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
              <span className="hidden sm:inline">{ui.home.groupBy}</span>
            </button>

            <button
              onClick={handleToggleCompactView}
              disabled={mobileCompactViewForced}
              className={`flex h-14 items-center justify-center gap-1.5 px-3 rounded-xl border text-sm font-medium transition-all duration-150 active:translate-y-px active:scale-[0.99] whitespace-nowrap sm:flex-none ${
                compactView
                  ? 'bg-gradient-to-br from-sky-50 via-cyan-50 to-indigo-50 dark:from-sky-900/40 dark:via-cyan-900/30 dark:to-indigo-900/40 border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 shadow-sm shadow-sky-200/50'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700'
              } ${mobileCompactViewForced ? 'opacity-70 cursor-not-allowed' : ''}`}
              title={mobileCompactViewForced ? ui.home.compactViewForcedTitle : (compactView ? ui.home.cardsLabel : ui.home.compactViewTitle)}
            >
              {compactView ? <Rows3 className="w-4 h-4" /> : <List className="w-4 h-4" />}
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
                      ? 'bg-purple-600 text-white dark:bg-purple-500 dark:text-white'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/55 dark:text-purple-300 dark:hover:bg-purple-900/55'
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
                className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {ui.home.allTags}
              </button>
            )}
          </div>
        )}
      </div>

      {/* App grid */}
      <div
        ref={catalogRef}
        className="transition-shadow"
      >
        {loading ? (
        compactView ? (
          <div className="flex flex-col gap-1.5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-12 bg-white dark:bg-gray-900 rounded-xl animate-pulse border border-gray-100 dark:border-gray-800" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-2xl p-6 h-48 animate-pulse border border-gray-100 dark:border-gray-800" />
            ))}
          </div>
        )
          ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 dark:text-gray-500">
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
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-700 bg-purple-100 dark:text-purple-300 dark:bg-purple-950/60 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                  <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
                </div>
                {renderAppGrid(groupApps, { canSpotlight: false })}
              </div>
            ))}
        </div>
      ) : (
        renderAppGrid(filtered)
      )}
      </div>

      {tourOpen && (
        <div className="fixed inset-0 z-50">
          {spotlightRects.length > 0 ? (
            <svg className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
              <defs>
                <mask id={spotlightMaskId}>
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  {spotlightRects.map((rect, index) => (
                    <rect
                      key={index}
                      x={Math.max(rect.left, 0)}
                      y={Math.max(rect.top, 0)}
                      width={Math.max(rect.width, 0)}
                      height={Math.max(rect.height, 0)}
                      rx="24"
                      fill="black"
                    />
                  ))}
                </mask>
              </defs>
              <rect x="0" y="0" width="100%" height="100%" fill="rgba(0, 0, 0, 0.55)" mask={`url(#${spotlightMaskId})`} />
            </svg>
          ) : (
            <div className="absolute inset-0 bg-black/55" />
          )}

          {spotlightRects.map((rect, index) => (
            <div
              key={index}
              className="absolute rounded-3xl ring-4 ring-accent/50 pointer-events-none"
              style={{
                top: `${Math.max(rect.top, 0)}px`,
                left: `${Math.max(rect.left, 0)}px`,
                width: `${Math.max(rect.width, 0)}px`,
                height: `${Math.max(rect.height, 0)}px`,
              }}
            />
          ))}

          <div className={`absolute inset-0 z-10 flex ${isCenteredTourStep ? 'items-center justify-center p-4 sm:p-6' : 'items-end justify-center p-4 sm:items-end sm:justify-end sm:p-6'}`}>
            <div className={`w-full ${isCenteredTourStep ? 'max-w-xl' : 'max-w-2xl'} rounded-3xl border border-white/15 bg-white dark:bg-gray-900 shadow-2xl shadow-black/30 p-5 sm:p-6 text-left`}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent-dark dark:text-accent">
                    {tourProgressLabel}
                  </p>
                  <h2 className="mt-2 text-xl sm:text-2xl font-bold text-dark dark:text-gray-100">
                    {currentTourStep.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeTour}
                  className="rounded-full border border-gray-200 dark:border-gray-700 p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white"
                  aria-label={ui.home.tour.skip}
                  title={ui.home.tour.skip}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-sm sm:text-base leading-relaxed text-gray-600 dark:text-gray-300">
                {currentTourStep.body}
              </p>

              {tourBrowserDocs.length > 0 && (
                <div className="mt-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400">
                    {ui.home.tour.browserDocsTitle}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {ui.home.tour.browserDocsHint}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {tourBrowserDocs.map((doc) => (
                      <a
                        key={doc.browser}
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          doc.detected
                            ? 'border-accent/40 bg-accent/10 text-dark dark:text-gray-100'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-dark dark:hover:text-white'
                        }`}
                      >
                        <span className="block font-semibold">{doc.label}</span>
                        <span className="block text-xs opacity-80">
                          {doc.detected ? ui.home.tour.browserDocsPrimary : ui.home.tour.browserDocsSecondary}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                {!isLastTourStep ? (
                  <button
                    type="button"
                    onClick={closeTour}
                    className="inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white"
                  >
                    {ui.home.tour.skip}
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTourPrevious}
                    disabled={tourStepIndex === 0}
                    className="inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {ui.home.tour.previous}
                  </button>
                  <button
                    type="button"
                    onClick={handleTourNext}
                    className="inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-dark transition-colors hover:bg-accent/90"
                  >
                    {tourStepIndex === totalTourSteps - 1 ? ui.home.tour.done : ui.home.tour.next}
                  </button>
                </div>
              </div>

              <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
                {ui.home.tour.reopenHint}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
