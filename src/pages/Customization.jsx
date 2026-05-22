import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Database, Eye, Home, Image, LogIn, Save, Settings, Smartphone, SlidersHorizontal, Trash2, Type, Wrench } from 'lucide-react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import { getSupportedLanguageOptions, getUiStrings, normalizeLanguage, resolveAppLanguage } from '../i18n';

const emptyBranding = {
  heroTitleLine1: 'Your apps,',
  heroTitleLine2: 'all in one place.',
  heroSubtitle: 'Quickly access all the tools and platforms in your workspace.',
  showHomeHero: true,
  hideHomeHeroOnMobile: false,
  showAppModeBadges: true,
  defaultHomeDesktopView: 'cards',
  defaultCompactView: false,
  defaultLanguage: 'en',
  defaultColorScheme: 'light',
  enableDarkModeBeta: false,
  useEuropeanDateFormat: false,
  use24hTimeFormat: false,
  logRetentionDays: 90,
  hideLoginPage: false,
  showSharedCookieMode: true,
  showRedirectSsoMode: true,
  showEntraAppMode: true,
};

const brandingKeys = [
  'heroTitleLine1',
  'heroTitleLine2',
  'heroSubtitle',
  'showHomeHero',
  'hideHomeHeroOnMobile',
  'showAppModeBadges',
  'defaultHomeDesktopView',
  'defaultCompactView',
  'defaultLanguage',
  'defaultColorScheme',
  'enableDarkModeBeta',
  'useEuropeanDateFormat',
  'use24hTimeFormat',
  'logRetentionDays',
  'hideLoginPage',
  'showSharedCookieMode',
  'showRedirectSsoMode',
  'showEntraAppMode',
];

export default function Customization() {
  const { user } = useAuthStore();
  const location = useLocation();
  const isOwner = user?.role === 'owner';
  const [branding, setBranding] = useState(emptyBranding);
  const [initialBranding, setInitialBranding] = useState(emptyBranding);
  const [uiLanguage, setUiLanguage] = useState('en');
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingLogoDataUrl, setBrandingLogoDataUrl] = useState('');
  const [brandingLogoPreview, setBrandingLogoPreview] = useState(null);
  const [brandingLogoFileName, setBrandingLogoFileName] = useState('');
  const [removeBrandingLogo, setRemoveBrandingLogo] = useState(false);
  const [pageNotice, setPageNotice] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [avatarRefreshing, setAvatarRefreshing] = useState(false);
  const [iconCacheCleaning, setIconCacheCleaning] = useState(false);
  const [accessLogPurging, setAccessLogPurging] = useState(false);
  const [cacheStats, setCacheStats] = useState(null);
  const [cacheStatsLoading, setCacheStatsLoading] = useState(true);
  const noticeTimer = useRef(null);
  const saveNoticeTimer = useRef(null);
  const brandingSectionRef = useRef(null);
  const appOptionsSectionRef = useRef(null);
  const homeOptionsSectionRef = useRef(null);
  const preferencesSectionRef = useRef(null);
  const mobileOptionsSectionRef = useRef(null);
  const maintenanceSectionRef = useRef(null);
  const brandingLogoInputRef = useRef(null);
  const ui = useMemo(() => getUiStrings(uiLanguage), [uiLanguage]);
  const languageOptions = useMemo(() => getSupportedLanguageOptions(ui), [ui]);
  const sectionRefs = useMemo(() => ({
    login: homeOptionsSectionRef,
    home: brandingSectionRef,
    apps: appOptionsSectionRef,
    preferences: preferencesSectionRef,
    mobile: mobileOptionsSectionRef,
    maintenance: maintenanceSectionRef,
  }), []);

  const pushNotice = (type, message) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setPageNotice({ type, message });
    noticeTimer.current = setTimeout(() => {
      setPageNotice(null);
      noticeTimer.current = null;
    }, 4500);
  };

  const pushSaveNotice = (type, message) => {
    if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
    setSaveNotice({ type, message });
    saveNoticeTimer.current = setTimeout(() => {
      setSaveNotice(null);
      saveNoticeTimer.current = null;
    }, 4500);
  };

  const openConfirm = (dialog) => setConfirmDialog(dialog);
  const closeConfirm = () => {
    if (confirmBusy) return;
    setConfirmDialog(null);
  };
  const runConfirm = async () => {
    if (!confirmDialog?.onConfirm) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
    } finally {
      setConfirmBusy(false);
      setConfirmDialog(null);
    }
  };

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes)) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const loadBranding = () => {
    setBrandingLoading(true);
    api.get('/branding')
      .then((res) => {
        const next = res.data.branding || emptyBranding;
        setBranding(next);
        setInitialBranding(next);
        setUiLanguage(resolveAppLanguage(user?.preferredLanguage, next.defaultLanguage));
        setBrandingLogoPreview(next.logoUrl || null);
        setBrandingLogoDataUrl('');
        setBrandingLogoFileName('');
        setRemoveBrandingLogo(false);
      })
      .catch(() => {
        setBranding(emptyBranding);
        setInitialBranding(emptyBranding);
        setUiLanguage(resolveAppLanguage(user?.preferredLanguage, 'en'));
        setBrandingLogoPreview(null);
      })
      .finally(() => setBrandingLoading(false));
  };

  const loadCacheStats = () => {
    setCacheStatsLoading(true);
    api.get('/branding/cache')
      .then((res) => setCacheStats(res.data || null))
      .catch(() => setCacheStats(null))
      .finally(() => setCacheStatsLoading(false));
  };

  const refreshAvatarCache = async () => {
    setAvatarRefreshing(true);
    try {
      const res = await api.post('/branding/avatars/refresh');
      const version = String(Date.now());
      try {
        window.localStorage.setItem('frontdoor_avatar_cache_version', version);
      } catch {
        // ignore localStorage failures
      }
      window.dispatchEvent(new Event('frontdoor:avatar-cache-refresh'));
      loadCacheStats();
      const cacheCleared = res.data?.removed
        ? ui.customization.maintenance.avatarCacheClearedWithCount.replace('{count}', res.data.removed)
        : ui.customization.maintenance.avatarCacheCleared;
      pushSaveNotice(
        'success',
        `${cacheCleared}. ${ui.customization.maintenance.avatarCacheReloadNotice}`
      );
    } catch (err) {
      pushSaveNotice('error', err.response?.data?.error || ui.admin.common.errorRefreshingAvatarCache);
    }
    setAvatarRefreshing(false);
  };

  const cleanupAppIconCache = async () => {
    setIconCacheCleaning(true);
    try {
      const res = await api.post('/branding/app-icons/cleanup');
      loadCacheStats();
      const message = res.data?.removed
        ? ui.customization.maintenance.appIconCacheClearedWithCount.replace('{count}', res.data.removed)
        : ui.customization.maintenance.appIconCacheCleared;
      pushSaveNotice('success', `${message}. ${ui.customization.maintenance.appIconCacheReloadNotice}`);
    } catch (err) {
      pushSaveNotice('error', err.response?.data?.error || ui.admin.common.errorSaving);
    }
    setIconCacheCleaning(false);
  };

  const clearAccessLog = async () => {
    setAccessLogPurging(true);
    try {
      const res = await api.post('/logs/clear-access');
      const clearedMessage = res.data?.accessRemoved
        ? ui.customization.maintenance.accessLogClearedWithCount.replace('{count}', res.data.accessRemoved)
        : ui.customization.maintenance.accessLogCleared;
      pushSaveNotice(
        'success',
        `${clearedMessage}. ${ui.customization.maintenance.accessLogReloadNotice}`
      );
    } catch (err) {
      pushSaveNotice('error', err.response?.data?.error || ui.admin.common.errorSaving);
    }
    setAccessLogPurging(false);
  };

  useEffect(() => {
    loadBranding();
    loadCacheStats();
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
    };
  }, []);

  useEffect(() => {
    setUiLanguage(resolveAppLanguage(user?.preferredLanguage, initialBranding.defaultLanguage));
  }, [user?.preferredLanguage, initialBranding.defaultLanguage]);

  const handleBrandingLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBrandingLogoFileName(file.name);

    if (file.size > 2 * 1024 * 1024) {
      pushNotice('error', ui.customization.preferences.logoTooLarge);
      setBrandingLogoFileName('');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setBrandingLogoDataUrl(dataUrl);
      setBrandingLogoPreview(dataUrl);
      setRemoveBrandingLogo(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    try {
      const retentionChanged = branding.logRetentionDays !== initialBranding.logRetentionDays;
      const payload = {
        heroTitleLine1: branding.heroTitleLine1,
        heroTitleLine2: branding.heroTitleLine2,
        heroSubtitle: branding.heroSubtitle,
        showHomeHero: branding.showHomeHero,
        hideHomeHeroOnMobile: branding.hideHomeHeroOnMobile,
        showAppModeBadges: branding.showAppModeBadges,
        defaultHomeDesktopView: branding.defaultHomeDesktopView,
        defaultCompactView: branding.defaultCompactView,
        defaultLanguage: branding.defaultLanguage,
        defaultColorScheme: branding.defaultColorScheme,
        enableDarkModeBeta: branding.enableDarkModeBeta,
        useEuropeanDateFormat: branding.useEuropeanDateFormat,
        use24hTimeFormat: branding.use24hTimeFormat,
        logRetentionDays: branding.logRetentionDays,
        hideLoginPage: branding.hideLoginPage,
        showSharedCookieMode: branding.showSharedCookieMode,
        showRedirectSsoMode: branding.showRedirectSsoMode,
        showEntraAppMode: branding.showEntraAppMode,
        ...(removeBrandingLogo ? { removeLogo: true } : {}),
        ...(brandingLogoDataUrl ? { logoDataUrl: brandingLogoDataUrl } : {}),
      };

      const res = await api.put('/branding', payload);
      const next = res.data.branding || emptyBranding;
      setBranding(next);
      setInitialBranding(next);
      setUiLanguage(resolveAppLanguage(user?.preferredLanguage, next.defaultLanguage));
      setBrandingLogoPreview(next.logoUrl || null);
      setBrandingLogoDataUrl('');
      setBrandingLogoFileName('');
      setRemoveBrandingLogo(false);
      window.dispatchEvent(new CustomEvent('frontdoor:branding-updated', { detail: next }));
      pushSaveNotice(
        'success',
        retentionChanged
          ? `${ui.common.changesSaved}. ${ui.customization.preferences.logRetentionNextCleanup}`
          : ui.common.changesSaved
      );
    } catch (err) {
      pushSaveNotice('error', err.response?.data?.error || ui.admin.common.errorSaving);
    }
    setBrandingSaving(false);
  };

  const isDirty = useMemo(() => {
    const brandingDirty = brandingKeys.some((key) => branding?.[key] !== initialBranding?.[key]);
    const logoDirty = Boolean(brandingLogoDataUrl || removeBrandingLogo);
    return brandingDirty || logoDirty;
  }, [branding, initialBranding, brandingLogoDataUrl, removeBrandingLogo]);

  const scrollToSection = useCallback((ref) => {
    if (!ref.current) return;
    const offset = window.innerWidth >= 1280 ? 112 : 96;
    const top = ref.current.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, []);

  const jumpTo = useCallback((sectionId, ref) => {
    if (!ref.current) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${sectionId}`);
    scrollToSection(ref);
  }, [scrollToSection]);

  useEffect(() => {
    if (brandingLoading || cacheStatsLoading) return;
    const sectionId = location.hash.replace('#', '');
    if (!sectionId) return;
    const targetRef = sectionRefs[sectionId];
    if (!targetRef?.current) return;
    const frame = window.requestAnimationFrame(() => scrollToSection(targetRef));
    return () => window.cancelAnimationFrame(frame);
  }, [brandingLoading, cacheStatsLoading, location.hash, scrollToSection, sectionRefs]);

  const sectionNav = [
    { id: 'login', label: ui.customization.login.title, ref: homeOptionsSectionRef, icon: LogIn },
    { id: 'home', label: ui.customization.home.title, ref: brandingSectionRef, icon: Home },
    { id: 'apps', label: ui.customization.apps.title, ref: appOptionsSectionRef, icon: Settings },
    { id: 'preferences', label: ui.customization.preferences.title, ref: preferencesSectionRef, icon: SlidersHorizontal },
    { id: 'mobile', label: ui.customization.mobile.title, ref: mobileOptionsSectionRef, icon: Smartphone },
    { id: 'maintenance', label: ui.customization.maintenance.title, ref: maintenanceSectionRef, icon: Wrench },
  ];

  const renderSaveStatusBar = (key) => (
    <div key={key} className="mt-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-950/50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.common.changeStatus}</p>
          {saveNotice ? (
            <p className={`text-xs font-medium ${saveNotice.type === 'error' ? 'text-red-600' : 'text-accent-dark'}`}>
              {saveNotice.message}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isDirty ? ui.common.unsavedChanges : ui.common.noPendingChanges}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSaveBranding}
          disabled={brandingSaving || !isDirty}
          className="inline-flex items-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
        >
          <Save className={`w-4 h-4 ${brandingSaving ? 'animate-pulse' : ''}`} />
          {brandingSaving ? ui.common.saving : ui.common.saveChanges}
        </button>
      </div>
    </div>
  );

  return (
    <div className="pb-24">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-dark dark:text-gray-100">{ui.customization.title}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{ui.customization.subtitle}</p>
        </div>
      </div>

      {pageNotice && (
        <div
          className={`mb-8 flex items-start gap-3 rounded-2xl border px-4 py-3 ${
            pageNotice.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-accent/30 bg-accent/10 text-dark dark:text-gray-100'
          }`}
        >
          {pageNotice.type === 'error' ? (
            <AlertCircle className="mt-0.5 w-5 h-5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 w-5 h-5 shrink-0" />
          )}
          <div className="text-sm font-medium">{pageNotice.message}</div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden xl:block xl:sticky xl:top-24 h-fit">
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-dark dark:text-gray-100">{ui.customization.navigationTitle}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{ui.customization.navigationSubtitle}</p>
            </div>
            <div className="flex xl:flex-col gap-2 overflow-x-auto pb-1 xl:pb-0">
              {sectionNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => jumpTo(item.id, item.ref)}
                    className="inline-flex items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-white dark:hover:bg-gray-900 min-w-[170px] xl:min-w-0"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                      {item.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 hidden xl:block" />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="flex flex-col gap-4">
          <div className="xl:hidden rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-sm font-bold text-dark dark:text-gray-100">{ui.customization.goToSection}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{ui.customization.navigationSubtitle}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {sectionNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => jumpTo(item.id, item.ref)}
                    className="inline-flex w-full items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:border-gray-300 dark:hover:border-gray-600 hover:bg-white dark:hover:bg-gray-900"
                  >
                    <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <section id="login" ref={homeOptionsSectionRef} className="scroll-mt-32 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center">
                <LogIn className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.login.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.login.subtitle}</p>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
              <input
                type="checkbox"
                checked={branding.hideLoginPage === true}
                onChange={(e) => setBranding({ ...branding, hideLoginPage: e.target.checked })}
                className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
              />
              <span>
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.login.hideLoginPageLabel}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.login.hideLoginPageHelp}</span>
              </span>
            </label>

            {renderSaveStatusBar('login')}
          </section>

          <section id="home" ref={brandingSectionRef} className="scroll-mt-32 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-accent/10 dark:bg-accent-dark/25 flex items-center justify-center">
                <Home className="w-5 h-5 text-accent-dark dark:text-gray-100" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.home.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.home.subtitle}</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/45 p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center">
                      <Type className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.home.textsTitle}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.home.textsSubtitle}</p>
                    </div>
                  </div>

                  {brandingLoading ? (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                      <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                      <div className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{ui.customization.hero.line1}</label>
                        <input
                          type="text"
                          value={branding.heroTitleLine1}
                          onChange={(e) => setBranding({ ...branding, heroTitleLine1: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{ui.customization.hero.line2}</label>
                        <input
                          type="text"
                          value={branding.heroTitleLine2}
                          onChange={(e) => setBranding({ ...branding, heroTitleLine2: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{ui.customization.hero.subtitle}</label>
                        <textarea
                          rows="3"
                          value={branding.heroSubtitle}
                          onChange={(e) => setBranding({ ...branding, heroSubtitle: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500 resize-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/45 p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-10 h-10 rounded-xl border border-amber-100/80 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center">
                      <Image className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.home.logoTitle}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.home.logoSubtitle}</p>
                    </div>
                  </div>

                  {brandingLoading ? (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                      <div className="h-24 bg-gray-100 dark:bg-gray-800 rounded-2xl" />
                      <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <input
                        ref={brandingLogoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
                        onChange={handleBrandingLogoChange}
                        className="hidden"
                      />
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <button
                          type="button"
                          onClick={() => brandingLogoInputRef.current?.click()}
                          className="inline-flex items-center justify-center rounded-xl bg-accent/20 dark:bg-accent-dark/25 px-4 py-2.5 text-sm font-semibold text-dark dark:text-gray-100 transition-colors hover:bg-accent/30 dark:hover:bg-accent-dark/40"
                        >
                          {ui.customization.home.chooseFile}
                        </button>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {brandingLogoFileName || ui.customization.home.noFileSelected}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {ui.customization.preferences.assetFileHint}
                      </p>

                      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 min-h-[150px] flex items-center justify-center">
                        {brandingLogoPreview ? (
                          <img
                            src={brandingLogoPreview}
                            alt={ui.customization.hero.selectedLogo}
                            className="max-h-24 max-w-[220px] object-contain"
                          />
                        ) : (
                          <div className="text-center text-gray-400 dark:text-gray-500">
                            <Image className="w-8 h-8 mx-auto mb-2" />
                            <p className="text-xs">{ui.customization.hero.noLogo}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setRemoveBrandingLogo(true);
                            setBrandingLogoDataUrl('');
                            setBrandingLogoPreview(null);
                            setBrandingLogoFileName('');
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 rounded-xl font-semibold text-sm hover:bg-red-100 dark:hover:bg-red-900/45 transition-colors"
                        >
                          {ui.customization.hero.removeLogo}
                        </button>
                        {branding.logoUrl && !removeBrandingLogo && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">{ui.customization.hero.currentLogoActive}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/45 p-6">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center">
                    <Eye className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.home.previewTitle}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.home.previewSubtitle}</p>
                  </div>
                </div>

                {brandingLoading ? (
                  <div className="h-[220px] rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                ) : (
                  <div className="rounded-2xl bg-gradient-to-br from-accent/20 via-white to-white dark:from-accent-dark/20 dark:via-gray-900 dark:to-gray-950 p-4">
                    <div className="rounded-2xl bg-white/90 border border-white/80 dark:bg-gray-900/95 dark:border-gray-700 p-4 md:p-5 min-h-[220px] flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                      <div className="min-w-0">
                        <div className="text-2xl md:text-3xl font-extrabold text-dark dark:text-gray-100 leading-tight">
                          {branding.heroTitleLine1}<br />
                          <span className="text-dark/70 dark:text-gray-400">{branding.heroTitleLine2}</span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 max-w-lg">{branding.heroSubtitle}</p>
                      </div>
                      <div className="flex items-center justify-center md:justify-end min-w-[160px]">
                        {brandingLogoPreview ? (
                          <img
                            src={brandingLogoPreview}
                            alt={ui.customization.hero.selectedLogo}
                            className="max-h-24 max-w-[180px] object-contain"
                          />
                        ) : (
                          <div className="w-28 h-28 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-300 dark:text-gray-600">
                            <Image className="w-8 h-8" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={branding.showHomeHero !== false}
                    onChange={(e) => setBranding({ ...branding, showHomeHero: e.target.checked })}
                    className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.home.heroLabel}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.home.heroHelp}</span>
                  </span>
                </label>

                <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gray-900/5 dark:bg-white/10 flex items-center justify-center">
                      <Eye className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label htmlFor="home-desktop-view" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                        {ui.customization.home.desktopViewLabel}
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {ui.customization.home.desktopViewHelp}
                      </p>
                      <select
                        id="home-desktop-view"
                        value={branding.defaultHomeDesktopView}
                        onChange={(e) => setBranding({ ...branding, defaultHomeDesktopView: e.target.value })}
                        className="mt-3 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-accent focus:ring-accent disabled:opacity-60"
                      >
                        <option value="cards">{ui.customization.home.cards}</option>
                        <option value="compact">{ui.customization.home.compact}</option>
                      </select>
                    </div>
                  </div>
                </div>

                {renderSaveStatusBar('home')}
              </div>
            </div>
          </section>

          <section id="apps" ref={appOptionsSectionRef} className="scroll-mt-32 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center">
                <Settings className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.apps.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.apps.subtitle}</p>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
              <input
                type="checkbox"
                checked={branding.showAppModeBadges !== false}
                onChange={(e) => setBranding({ ...branding, showAppModeBadges: e.target.checked })}
                className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
              />
              <span>
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.apps.badgesLabel}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.apps.badgesHelp}</span>
              </span>
            </label>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.showSharedCookieMode !== false}
                  onChange={(e) => setBranding({ ...branding, showSharedCookieMode: e.target.checked })}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.apps.sharedCookieLabel}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.apps.sharedCookieHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.showRedirectSsoMode !== false}
                  onChange={(e) => setBranding({ ...branding, showRedirectSsoMode: e.target.checked })}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.apps.redirectLabel}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.apps.redirectHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.showEntraAppMode !== false}
                  onChange={(e) => setBranding({ ...branding, showEntraAppMode: e.target.checked })}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.apps.entraLabel}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.apps.entraHelp}</span>
                </span>
              </label>
            </div>

            {renderSaveStatusBar('app')}
          </section>

          <section id="preferences" ref={preferencesSectionRef} className="scroll-mt-32 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <SlidersHorizontal className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.preferences.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.preferences.subtitle}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.customization.preferences.languageTitle}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.preferences.languageHelp}</p>
                  </div>
                  <select
                    value={branding.defaultLanguage || 'en'}
                    onChange={(e) => setBranding({ ...branding, defaultLanguage: normalizeLanguage(e.target.value) })}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-accent focus:ring-accent lg:w-72"
                  >
                    {languageOptions.map((language) => (
                      <option key={language.code} value={language.code}>{language.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 dark:border-amber-800/55 bg-amber-50/70 dark:bg-amber-950/25 px-4 py-3 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={branding.enableDarkModeBeta === true}
                    onChange={(e) => setBranding({ ...branding, enableDarkModeBeta: e.target.checked })}
                    className="mt-1 rounded border-amber-300 dark:border-amber-700 text-amber-600 focus:ring-amber-400"
                  />
                  <span className="min-w-0">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-gray-100">
                      {ui.customization.preferences.darkModeBetaTitle}
                      <span className="inline-flex items-center rounded-full bg-amber-200 dark:bg-amber-900/55 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                        {ui.customization.preferences.betaBadge}
                      </span>
                    </span>
                    <span className="block text-xs text-gray-600 dark:text-gray-400 mt-1">{ui.customization.preferences.darkModeBetaHelp}</span>
                  </span>
                </label>

                <div className={`flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-xl border border-amber-100 dark:border-amber-900/40 bg-white/70 dark:bg-gray-900/60 px-4 py-3 transition-opacity ${branding.enableDarkModeBeta ? '' : 'opacity-50 pointer-events-none'}`}>
                  <div>
                    <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.customization.preferences.colorSchemeTitle}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.preferences.colorSchemeHelp}</p>
                  </div>
                  <select
                    value={branding.defaultColorScheme || 'light'}
                    onChange={(e) => setBranding({ ...branding, defaultColorScheme: e.target.value })}
                    disabled={!branding.enableDarkModeBeta}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-accent focus:ring-accent lg:w-72 disabled:cursor-not-allowed"
                  >
                    <option value="light">{ui.customization.preferences.colorSchemeLight}</option>
                    <option value="dark">{ui.customization.preferences.colorSchemeDark}</option>
                    <option value="auto">{ui.customization.preferences.colorSchemeAuto}</option>
                  </select>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.use24hTimeFormat === true}
                  onChange={(e) => setBranding({ ...branding, use24hTimeFormat: e.target.checked })}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.preferences.timeFormatTitle}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.preferences.timeFormatHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.useEuropeanDateFormat === true}
                  onChange={(e) => setBranding({ ...branding, useEuropeanDateFormat: e.target.checked })}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.preferences.dateFormatTitle}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.preferences.dateFormatHelp}</span>
                </span>
              </label>

              <div className="rounded-2xl border border-amber-100 dark:border-amber-800/55 bg-amber-50/50 dark:bg-amber-950/30 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.customization.preferences.logRetentionTitle}</p>
                      <div className={`rounded-full px-3 py-1 text-xs font-semibold ${branding.logRetentionDays === 0 ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' : 'bg-white dark:bg-gray-900 text-amber-700 dark:text-amber-300'}`}>
                        {branding.logRetentionDays === 0 ? ui.customization.preferences.logless : `${branding.logRetentionDays} ${ui.common.days}`}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{ui.customization.preferences.logRetentionHelp}</p>
                  </div>
                </div>

                {!brandingLoading ? (
                  <div className="mt-4 space-y-4">
                    <input
                      type="range"
                      min="0"
                      max="90"
                      step="1"
                      value={branding.logRetentionDays ?? 90}
                      onChange={(e) => setBranding({ ...branding, logRetentionDays: parseInt(e.target.value, 10) })}
                      className="w-full accent-amber-500 dark:accent-amber-400"
                    />

                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>0 = {ui.customization.preferences.logless}</span>
                      <span>90 = {ui.customization.preferences.recommended}</span>
                    </div>

                    <p className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 leading-6">
                      {ui.customization.preferences.logRetentionNotice}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 h-24 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                )}
              </div>
            </div>

            {renderSaveStatusBar('preferences')}
          </section>

          <section id="mobile" ref={mobileOptionsSectionRef} className="scroll-mt-32 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950/50 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.mobile.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.mobile.subtitle}</p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.defaultCompactView === true}
                  onChange={(e) => setBranding({ ...branding, defaultCompactView: e.target.checked })}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.mobile.compactLabel}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.mobile.compactHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.hideHomeHeroOnMobile === true}
                  onChange={(e) => setBranding({ ...branding, hideHomeHeroOnMobile: e.target.checked })}
                  className="mt-1 rounded border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">{ui.customization.mobile.hideHeroLabel}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.mobile.hideHeroHelp}</span>
                </span>
              </label>
            </div>

            {renderSaveStatusBar('mobile')}
          </section>

          <section id="maintenance" ref={maintenanceSectionRef} className="scroll-mt-32 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center">
                <Wrench className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark dark:text-gray-100">{ui.customization.maintenance.title}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{ui.customization.maintenance.subtitle}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.customization.maintenance.avatarCacheTitle}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.maintenance.avatarCacheHelp}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {cacheStatsLoading ? ui.common.loading : `${cacheStats?.avatarCache?.files || 0} ${ui.customization.maintenance.cacheFiles} · ${formatBytes(cacheStats?.avatarCache?.bytes || 0)}`}
                    </p>
                  </div>
                  <div className="flex items-start lg:shrink-0">
                    <button
                      type="button"
                      onClick={() => openConfirm({
                        title: ui.customization.maintenance.refreshAvatarCacheConfirmTitle,
                        message: ui.customization.maintenance.refreshAvatarCacheConfirmMessage,
                        confirmLabel: ui.customization.maintenance.refreshAvatarCacheConfirmLabel,
                        onConfirm: refreshAvatarCache,
                      })}
                      disabled={avatarRefreshing}
                      className="inline-flex min-w-[212px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {avatarRefreshing ? ui.customization.maintenance.refreshAvatarCacheBusy : ui.customization.maintenance.refreshAvatarCache}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.customization.maintenance.appIconCacheTitle}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.maintenance.appIconCacheHelp}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-gray-400 dark:text-gray-500">
                      <span>
                        {cacheStatsLoading
                          ? ui.common.loading
                          : `${cacheStats?.appIconCache?.totalFiles || 0} ${ui.customization.maintenance.cacheFiles} · ${formatBytes(cacheStats?.appIconCache?.totalBytes || 0)} · ${cacheStats?.appIconCache?.orphanFiles || 0} ${ui.customization.maintenance.cacheOrphans} ·`}
                      </span>
                      <a
                        href="/admin/icons"
                        className="font-semibold text-dark dark:text-gray-100 underline decoration-accent decoration-2 underline-offset-2 transition-colors hover:text-accent-dark hover:decoration-accent-dark"
                      >
                        {ui.customization.maintenance.openMediaLibrary}
                      </a>
                    </p>
                  </div>
                  <div className="flex items-start lg:shrink-0">
                    <button
                      type="button"
                      onClick={() => openConfirm({
                        title: ui.customization.maintenance.refreshAppIconCacheConfirmTitle,
                        message: ui.customization.maintenance.refreshAppIconCacheConfirmMessage,
                        confirmLabel: ui.customization.maintenance.refreshAppIconCacheConfirmLabel,
                        onConfirm: cleanupAppIconCache,
                      })}
                      disabled={iconCacheCleaning}
                      className="inline-flex min-w-[212px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {iconCacheCleaning ? ui.customization.maintenance.refreshAppIconCacheBusy : ui.customization.maintenance.refreshAppIconCache}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-red-100 dark:border-red-900/55 bg-red-50/50 dark:bg-red-950/30 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.customization.maintenance.accessLogCleanupTitle}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{ui.customization.maintenance.accessLogCleanupHelp}</p>
                </div>
                  <div className="flex items-start lg:shrink-0">
                    <button
                      type="button"
                      onClick={() => openConfirm({
                        title: ui.customization.maintenance.clearAccessLogConfirmTitle,
                        message: ui.customization.maintenance.clearAccessLogConfirmMessage,
                        confirmLabel: ui.customization.maintenance.clearAccessLogConfirmLabel,
                        onConfirm: clearAccessLog,
                      })}
                      disabled={!isOwner || accessLogPurging}
                      className="inline-flex min-w-[212px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {accessLogPurging ? ui.customization.maintenance.clearAccessLogBusy : ui.customization.maintenance.clearAccessLog}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-dark dark:text-gray-100">{ui.customization.maintenance.backupRestoreTitle}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ui.customization.maintenance.backupRestoreHelp}</p>
                </div>
                <RouterLink
                  to="/admin/backup"
                  className="inline-flex min-w-[212px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
                >
                  <Database className="h-4 w-4" />
                  {ui.customization.maintenance.openBackupRestore}
                </RouterLink>
              </div>
            </div>
          </section>

        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || ui.common.confirm}
        cancelLabel={confirmDialog?.cancelLabel || ui.common.cancel}
        closeLabel={ui.common.closeDialog}
        busyLabel={ui.common.pleaseWait}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
