import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, X, Star, LayoutGrid, List } from 'lucide-react';
import api from '../services/api';
import AppCard from '../components/AppCard';
import TagGroupCard from '../components/TagGroupCard';

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

export default function Home() {
  const [apps, setApps] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [loading, setLoading] = useState(true);

  // Persisted preferences
  const [favorites, setFavorites] = useState(() => readJson(LS_FAVORITES, []));
  const [showFavorites, setShowFavorites] = useState(() => readJson(LS_SHOW_FAVORITES, false));
  const [groupByTag, setGroupByTag] = useState(() => readJson(LS_GROUP_BY_TAG, false));

  // Tag groups open/close state
  const [openGroups, setOpenGroups] = useState({});

  useEffect(() => {
    api.get('/apps').then((res) => {
      setApps(res.data.apps);
      setLoading(false);
    }).catch(() => setLoading(false));
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

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set();
    apps.forEach((app) => {
      (Array.isArray(app.tags) ? app.tags : []).forEach((t) => tagSet.add(t));
    });
    return [...tagSet].sort();
  }, [apps]);

  const toggleTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  // Filter apps
  const filtered = useMemo(() => {
    return apps.filter((app) => {
      // Favorites filter
      if (showFavorites && !favoritesSet.has(app.id)) return false;
      // Text search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesText =
          app.name.toLowerCase().includes(q) ||
          app.description?.toLowerCase().includes(q) ||
          (Array.isArray(app.tags) && app.tags.some((t) => t.toLowerCase().includes(q)));
        if (!matchesText) return false;
      }
      // Tag filter
      if (selectedTags.length > 0) {
        const appTags = Array.isArray(app.tags) ? app.tags : [];
        if (!selectedTags.some((t) => appTags.includes(t))) return false;
      }
      return true;
    });
  }, [apps, search, selectedTags, showFavorites, favoritesSet]);

  // Group filtered apps by tag
  const groupedByTag = useMemo(() => {
    if (!groupByTag) return null;
    const groups = {};
    const noTag = [];
    filtered.forEach((app) => {
      const appTags = Array.isArray(app.tags) ? app.tags : [];
      if (appTags.length === 0) {
        noTag.push(app);
      } else {
        appTags.forEach((tag) => {
          if (!groups[tag]) groups[tag] = [];
          groups[tag].push(app);
        });
      }
    });
    // Sort tags alphabetically
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

  const renderAppGrid = (appList) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {appList.map((app) => (
        <AppCard
          key={app.id}
          app={app}
          isFavorite={favoritesSet.has(app.id)}
          onToggleFavorite={toggleFavorite}
        />
      ))}
    </div>
  );

  return (
    <div>
      {/* Hero section */}
      <div className="bg-gradient-to-br from-accent/30 via-accent/10 to-transparent rounded-3xl p-8 md:p-12 mb-10">
        <h1 className="text-3xl md:text-5xl font-extrabold text-dark leading-tight mb-4">
          Le tue applicazioni,<br />
          <span className="text-dark/70">tutte in un unico posto.</span>
        </h1>
        <p className="text-gray-600 text-lg max-w-xl">
          Accedi rapidamente a tutti gli strumenti e le piattaforme del tuo workspace.
        </p>
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

          {/* Favorites toggle */}
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

          {/* Group by tag toggle */}
          <button
            onClick={() => setGroupByTag((v) => !v)}
            className={`flex items-center gap-1.5 px-4 py-3.5 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap ${
              groupByTag
                ? 'bg-purple-50 border-purple-300 text-purple-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
            title={groupByTag ? 'Vista lista' : 'Raggruppa per tag'}
          >
            {groupByTag ? <LayoutGrid className="w-4 h-4" /> : <List className="w-4 h-4" />}
            <span className="hidden sm:inline">Raggruppa</span>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 h-48 animate-pulse border border-gray-100" />
          ))}
        </div>
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
          {/* Tag group cards */}
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

          {/* Expanded tag sections */}
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
