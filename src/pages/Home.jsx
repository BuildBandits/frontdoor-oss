import { useState, useEffect, useEffectEvent, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { X, Star, LayoutGrid, List, Rows3, AppWindow, RefreshCw } from 'lucide-react';
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
import Tooltip from '../components/Tooltip';
import { useAuthStore } from '../stores/authStore';
import { useBranding, useBrandingStore } from '../stores/brandingStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';
import PluginSurface from '../pluginHost/PluginSurface';
import { PLUGIN_SURFACES } from '../pluginHost/constants';
import {
  HOME_TOUR_HOMEPAGE_DOCS_EVENT,
  HOME_TOUR_REPLAY_EVENT,
  getHomeTourStepKeys,
  requestHomeTourAccountMenuClose,
  requestHomeTourAccountMenuOpen,
} from '../utils/homeTour';
import { getBrowserHomepageDocs } from '../utils/browserHomeDocs';

const LS_FAVORITES = 'frontdoor_favorites';
const LS_FAVORITES_OWNER = 'frontdoor_favorites_owner';
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

function sameStringArray(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export default function Home() {
  const {
    user,
    updateHomeDesktopView,
    updateAppOrder,
    updateFavoriteApps,
    markHomeTourSeen,
  } = useAuthStore();
  const [apps, setApps] = useState([]);
  const branding = useBranding();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appsLoadFailed, setAppsLoadFailed] = useState(false);
  const [refreshingApps, setRefreshingApps] = useState(false);
  // Settled once branding is known (cached or loaded) or its request failed.
  const brandingLoading = useBrandingStore((state) => !state.branding && !state.loaded && !state.failed);

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
  const [tourDocsOnly, setTourDocsOnly] = useState(false);
  const [spotlightRects, setSpotlightRects] = useState([]);
  const favoriteAppsBootstrapAttemptedRef = useRef(false);
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
    const stepOptions = {
      welcome: { targetRef: null, placement: 'center' },
      search: { targetRef: controlsRef },
      catalog: { targetRef: catalogRef },
      appCards: { targetRef: featuredAppRef, spotlightRefs: [featuredFavoriteRef, featuredInfoRef] },
      reorder: { targetRef: featuredAppRef, spotlightRefs: [featuredDragHandleRef] },
      menuButton: { targetRef: { current: null } },
      menu: { targetRef: { current: null }, openMenu: true },
      homepage: { targetRef: null, placement: 'center', browserDocs: browserHomepageDocs },
    };
    return getHomeTourStepKeys({ mobile: isMobileViewport }).map((key) => ({
      key,
      title: ui.home.tour.steps[key].title,
      body: ui.home.tour.steps[key].body,
      ...stepOptions[key],
    }));
  }, [browserHomepageDocs, isMobileViewport, ui]);
  const currentTourStep = tourSteps[tourStep] || tourSteps[0];
  const totalTourSteps = tourSteps.length;
  const tourProgressLabel = ui.home.tour.progress
    .replace('{current}', String(tourStep + 1))
    .replace('{total}', String(totalTourSteps));

  const loadApps = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshingApps(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.get('/apps');
      setApps(res.data.apps);
      setAppsLoadFailed(false);
    } catch {
      // A failed manual refresh keeps the current list; a failed first load is
      // reported instead of looking like an empty catalog.
      if (!silent) setAppsLoadFailed(true);
    } finally {
      if (silent) {
        setRefreshingApps(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    void api.post('/auth/home-activity').catch(() => {});
    return undefined;
  }, [userId]);

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

  useEffect(() => {
    favoriteAppsBootstrapAttemptedRef.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;

    const storedFavorites = readJson(LS_FAVORITES, []);
    const storedOwner = localStorage.getItem(LS_FAVORITES_OWNER);
    const remoteFavorites = Array.isArray(user.favoriteApps) ? user.favoriteApps : null;

    if (remoteFavorites) {
      favoriteAppsBootstrapAttemptedRef.current = true;
      if (!sameStringArray(favorites, remoteFavorites)) {
        setFavorites(remoteFavorites);
      }
      if (!sameStringArray(storedFavorites, remoteFavorites) || storedOwner !== user.id) {
        localStorage.setItem(LS_FAVORITES, JSON.stringify(remoteFavorites));
        localStorage.setItem(LS_FAVORITES_OWNER, user.id);
      }
      return;
    }

    if (storedOwner && storedOwner !== user.id) {
      favoriteAppsBootstrapAttemptedRef.current = true;
      if (favorites.length !== 0) {
        setFavorites([]);
      }
      if (storedFavorites.length !== 0) {
        localStorage.setItem(LS_FAVORITES, JSON.stringify([]));
      }
      return;
    }

    if (favoriteAppsBootstrapAttemptedRef.current || storedFavorites.length === 0) return;

    favoriteAppsBootstrapAttemptedRef.current = true;
    void updateFavoriteApps(storedFavorites, { migration: true }).catch(() => {
      favoriteAppsBootstrapAttemptedRef.current = false;
    });
  }, [favorites, updateFavoriteApps, user]);

  const closeTour = useCallback(() => {
    setTourDismissed(true);
    setTourOpen(false);
    setTourDocsOnly(false);
    setSpotlightRects([]);
    void markHomeTourSeen?.();
  }, [markHomeTourSeen]);

  const openTour = useCallback((stepIndex = 0, { docsOnly = false } = {}) => {
    const safeStepIndex = Math.max(0, Math.min(totalTourSteps - 1, stepIndex));
    setTourDocsOnly(docsOnly);
    setTourStep(safeStepIndex);
    setTourOpen(true);
  }, [totalTourSteps]);

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
    const onHomepageDocs = () => {
      openTour(totalTourSteps - 1, { docsOnly: true });
    };
    window.addEventListener(HOME_TOUR_HOMEPAGE_DOCS_EVENT, onHomepageDocs);
    return () => window.removeEventListener(HOME_TOUR_HOMEPAGE_DOCS_EVENT, onHomepageDocs);
  }, [openTour, totalTourSteps]);

  useEffect(() => {
    if (!languageReady) return undefined;

    if (location.state?.openHomeTourHomepageDocs) {
      openTour(totalTourSteps - 1, { docsOnly: true });
      navigate(location.pathname, { replace: true, state: null });
      return undefined;
    }

    if (!location.state?.replayHomeTour) return undefined;
    openTour();
    navigate(location.pathname, { replace: true, state: null });
    return undefined;
  }, [languageReady, location.pathname, location.state, navigate, openTour, totalTourSteps]);

  useEffect(() => {
    if (!tourOpen) return undefined;
    const target = currentTourStep?.targetRef?.current;
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return undefined;
  }, [currentTourStep, tourOpen, loading, apps.length]);

  useEffect(() => {
    const mobileMenuButton = document.getElementById('frontdoor-mobile-menu-button');

    if (!tourOpen) {
      requestHomeTourAccountMenuClose();
      if (mobileMenuButton?.getAttribute('aria-expanded') === 'true') {
        mobileMenuButton.click();
      }
      return undefined;
    }

    if (currentTourStep?.key === 'menu') {
      if (isMobileViewport) {
        requestHomeTourAccountMenuClose();
        if (mobileMenuButton?.getAttribute('aria-expanded') !== 'true') {
          mobileMenuButton.click();
        }
      } else {
        requestHomeTourAccountMenuOpen();
      }
    } else {
      requestHomeTourAccountMenuClose();
      if (isMobileViewport && mobileMenuButton?.getAttribute('aria-expanded') === 'true') {
        mobileMenuButton.click();
      }
    }

    return undefined;
  }, [currentTourStep?.key, isMobileViewport, tourOpen]);

  useEffect(() => {
    if (!tourOpen) {
      setSpotlightRects([]);
      return undefined;
    }

    const getTargetElements = () => {
      if (currentTourStep?.key === 'menuButton') {
        return [document.getElementById('frontdoor-mobile-menu-button')].filter(Boolean);
      }
      if (currentTourStep?.key === 'menu') {
        return [document.getElementById(isMobileViewport ? 'frontdoor-mobile-menu-panel' : 'frontdoor-account-menu-panel')].filter(Boolean);
      }
      if (Array.isArray(currentTourStep?.spotlightRefs) && currentTourStep.spotlightRefs.length > 0) {
        return currentTourStep.spotlightRefs.map((ref) => ref?.current).filter(Boolean);
      }
      return currentTourStep?.targetRef?.current ? [currentTourStep.targetRef.current] : [];
    };

    // Only a real change re-renders: the DOM observer below would otherwise loop.
    const applyRects = (next) => {
      setSpotlightRects((current) => (
        current.length === next.length
          && current.every((rect, index) => ['top', 'left', 'width', 'height'].every((key) => rect[key] === next[index][key]))
          ? current
          : next
      ));
    };

    const updateSpotlight = () => {
      const targets = getTargetElements();
      if (!targets.length) {
        applyRects([]);
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
        applyRects(rects);
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

      applyRects([{
        top: combinedRect.top,
        left: combinedRect.left,
        right: combinedRect.right,
        bottom: combinedRect.bottom,
        width: combinedRect.right - combinedRect.left,
        height: combinedRect.bottom - combinedRect.top,
      }]);
    };

    // Measure on the next frame, and again whenever elements are added or removed:
    // the target can appear late (the account menu opens through Layout, which may
    // render after a heavy Home), and measuring only once left it under the overlay.
    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateSpotlight();
      });
    };
    scheduleUpdate();
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [currentTourStep, isMobileViewport, tourOpen]);

  const toggleFavorite = useCallback((appId) => {
    setFavorites((prev) => {
      const next = prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId];
      localStorage.setItem(LS_FAVORITES, JSON.stringify(next));
      if (user?.id) {
        localStorage.setItem(LS_FAVORITES_OWNER, user.id);
      } else {
        localStorage.removeItem(LS_FAVORITES_OWNER);
      }
      void updateFavoriteApps(next).catch(() => {
        setFavorites(prev);
        localStorage.setItem(LS_FAVORITES, JSON.stringify(prev));
        if (user?.id) {
          localStorage.setItem(LS_FAVORITES_OWNER, user.id);
        } else {
          localStorage.removeItem(LS_FAVORITES_OWNER);
        }
      });
      return next;
    });
  }, [updateFavoriteApps, user?.id]);

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
    internalLinkBadgeShort: ui.home.internalLinkBadgeShort,
    ssoBadgeShort: ui.home.ssoBadgeShort,
  }), [ui]);

  const filtersActive = search.trim().length > 0 || selectedTags.length > 0;
  const dragEnabled = !groupByTag && !filtersActive && !compactView;
  const appCountLabel = (filtered.length === 1 ? ui.home.appCountOne : ui.home.appCount).replace('{count}', String(filtered.length));
  const hideMobileCompactControls = mobileCompactViewForced;
  const tourStepIndex = tourStep;
  const isLastTourStep = tourStepIndex === totalTourSteps - 1;
  const isCenteredTourStep = currentTourStep?.placement === 'center';
  const tourBrowserDocs = currentTourStep?.browserDocs ?? [];
  const handleRefreshApps = useCallback(() => {
    void loadApps({ silent: true });
  }, [loadApps]);

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

  // Effect event: always uses the latest step handlers without re-subscribing on every render.
  const onTourKeyDown = useEffectEvent((event) => {
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
  });

  useEffect(() => {
    if (!tourOpen) return undefined;

    const onKeyDown = (event) => onTourKeyDown(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tourOpen]);

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
    const spotlightTargetApp = canSpotlight && tourOpen && (currentTourStep?.key === 'appCards' || currentTourStep?.key === 'reorder')
      ? (
        currentTourStep?.key === 'appCards'
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
              tourShowDragHandle={tourOpen && currentTourStep?.key === 'reorder' && app.id === spotlightTargetId}
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
              tourShowDragHandle={tourOpen && currentTourStep?.key === 'reorder' && app.id === spotlightTargetId}
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
                tourShowDragHandle={tourOpen && currentTourStep?.key === 'reorder' && app.id === spotlightTargetId}
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
          className="bg-linear-to-br from-accent/30 via-accent/10 to-transparent dark:from-accent/15 dark:via-accent/5 dark:to-transparent rounded-3xl p-6 md:p-8 mb-8 overflow-hidden transition-shadow"
        >
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <h1 className="text-2xl md:text-4xl font-extrabold text-dark dark:text-gray-100 leading-tight md:leading-10 mb-3">
                {brandingLoading || !branding ? (
                  <>
                    {ui.home.heroTitleLine1}<br />
                    <span className="text-dark/70 dark:text-gray-300">{ui.home.heroTitleLine2}</span>
                  </>
                ) : (
                  <>
                    {branding.heroTitleLine1I18n?.[language] || branding.heroTitleLine1}<br />
                    <span className="text-dark/70 dark:text-gray-300">{branding.heroTitleLine2I18n?.[language] || branding.heroTitleLine2}</span>
                  </>
                )}
              </h1>
              <p className="text-gray-600 dark:text-gray-300 text-base md:text-lg max-w-xl">
                {brandingLoading || !branding ? (
                  ui.home.heroSubtitle
                ) : (
                  branding.heroSubtitleI18n?.[language] || branding.heroSubtitle
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

      <PluginSurface surface={PLUGIN_SURFACES.HOME_HERO_AFTER} variant="stack" className="mb-8" />

      {/* Search + toggles + tag filters */}
      <div
        ref={controlsRef}
        className="mb-8 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-xs"
      >
        <div className="flex items-stretch gap-3 min-w-0">
          <ClearableSearchField
            value={search}
            onChange={setSearch}
            placeholder={ui.home.searchPlaceholder}
            onKeyDown={handleSearchKeyDown}
            clearLabel={ui.common.clearSearch}
            searchShortcutTarget="primary"
            searchShortcutLabel={ui.common.searchShortcut}
            className="flex-1 min-w-0"
          />
          <div className="flex shrink-0 items-stretch gap-2 sm:gap-3 overflow-x-auto">
            <div className={`${hideMobileCompactControls ? 'flex' : 'hidden sm:flex'} h-12 shrink-0 items-center rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 text-sm font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap`}>
              {appCountLabel}
            </div>
            <Tooltip content={ui.home.refreshAppsTitle}>
              <button
                type="button"
                onClick={handleRefreshApps}
                disabled={refreshingApps}
                className="flex h-12 items-center justify-center gap-1.5 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 transition-all duration-150 active:translate-y-px active:scale-[0.99] whitespace-nowrap sm:flex-none disabled:cursor-wait disabled:opacity-70"
                aria-label={ui.home.refreshAppsTitle}
              >
                <RefreshCw className={`w-4 h-4 ${refreshingApps ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">
                  {refreshingApps ? ui.home.refreshAppsBusy : ui.home.refreshApps}
                </span>
              </button>
            </Tooltip>
            <Tooltip content={showFavorites ? ui.home.showAll : ui.home.favoritesTitle}>
              <button
                onClick={() => setShowFavorites((v) => !v)}
                className={`flex h-12 items-center justify-center gap-1.5 px-3 rounded-xl border text-sm font-medium transition-all duration-150 active:translate-y-px active:scale-[0.99] whitespace-nowrap sm:flex-none ${
                  showFavorites
                    ? 'bg-yellow-50 border-yellow-300 text-yellow-700 dark:bg-yellow-950/50 dark:border-yellow-600 dark:text-yellow-300'
                    : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700'
                }`}
                aria-label={showFavorites ? ui.home.showAll : ui.home.favoritesTitle}
              >
                <Star className="w-4 h-4" fill={showFavorites ? 'currentColor' : 'none'} />
                <span className="hidden sm:inline">{ui.home.favorites}</span>
              </button>
            </Tooltip>

            {!hideMobileCompactControls && (
              <>
                <Tooltip content={groupByTag ? ui.home.gridViewTitle : ui.home.groupByTitle}>
                  <button
                    onClick={handleToggleGroupByTag}
                    disabled={mobileCompactViewForced}
                    className={`flex h-12 items-center justify-center gap-1.5 px-3 rounded-xl border text-sm font-medium transition-all duration-150 active:translate-y-px active:scale-[0.99] whitespace-nowrap sm:flex-none ${
                      groupByTag
                        ? 'bg-purple-50 border-purple-300 text-purple-700 dark:bg-purple-950/50 dark:border-purple-600 dark:text-purple-300'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700'
                    } ${mobileCompactViewForced ? 'opacity-70 cursor-not-allowed' : ''}`}
                    aria-label={groupByTag ? ui.home.gridViewTitle : ui.home.groupByTitle}
                  >
                    {groupByTag ? <AppWindow className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
                    <span className="hidden sm:inline">{ui.home.groupBy}</span>
                  </button>
                </Tooltip>

                <Tooltip content={mobileCompactViewForced ? ui.home.compactViewForcedTitle : (compactView ? ui.home.cardsLabel : ui.home.compactViewTitle)}>
                  <button
                    onClick={handleToggleCompactView}
                    disabled={mobileCompactViewForced}
                    className={`flex h-12 items-center justify-center gap-1.5 px-3 rounded-xl border text-sm font-medium transition-all duration-150 active:translate-y-px active:scale-[0.99] whitespace-nowrap sm:flex-none ${
                      compactView
                        ? 'bg-linear-to-br from-sky-50 via-cyan-50 to-indigo-50 dark:from-sky-900/40 dark:via-cyan-900/30 dark:to-indigo-900/40 border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 shadow-xs shadow-sky-200/50'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700'
                    } ${mobileCompactViewForced ? 'opacity-70 cursor-not-allowed' : ''}`}
                    aria-label={mobileCompactViewForced ? ui.home.compactViewForcedTitle : (compactView ? ui.home.cardsLabel : ui.home.compactViewTitle)}
                  >
                    {compactView ? <Rows3 className="w-4 h-4" /> : <List className="w-4 h-4" />}
                    <span className="hidden sm:inline">{mobileCompactViewForced ? ui.home.compactMobileLabel : ui.home.compactLabel}</span>
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>

      <PluginSurface surface={PLUGIN_SURFACES.HOME_CONTROLS_AFTER} variant="stack" className="mb-8" />

      {allTags.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
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

      <PluginSurface surface={PLUGIN_SURFACES.HOME_CATALOG_BEFORE} variant="stack" className="mb-8" />

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
          ) : appsLoadFailed && apps.length === 0 ? (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400" role="alert">
          <p className="text-xl font-semibold mb-2">{ui.home.appsLoadFailedTitle}</p>
          <p>{ui.home.appsLoadFailedBody}</p>
          <button
            type="button"
            onClick={() => { void loadApps(); }}
            className="mt-5 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-semibold text-dark dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {ui.common.retry}
          </button>
        </div>
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
                ui={ui}
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

      <PluginSurface surface={PLUGIN_SURFACES.HOME_CATALOG_AFTER} variant="stack" className="mt-8" />

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
                  {!tourDocsOnly && (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent-dark dark:text-accent">
                      {tourProgressLabel}
                    </p>
                  )}
                  <h2 className="mt-2 text-xl sm:text-2xl font-bold text-dark dark:text-gray-100">
                    {currentTourStep.title}
                  </h2>
                </div>
                <Tooltip content={ui.home.tour.skip}>
                  <button
                    type="button"
                    onClick={closeTour}
                    className="rounded-full border border-gray-200 dark:border-gray-700 p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-dark dark:hover:text-white"
                    aria-label={ui.home.tour.skip}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Tooltip>
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

              {!tourDocsOnly && (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
