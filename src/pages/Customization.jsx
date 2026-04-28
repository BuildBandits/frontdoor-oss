import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, Eye, Home, Image, LogIn, Save, Settings, Smartphone, Trash2, Type, Wrench } from 'lucide-react';
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
  const [cacheStats, setCacheStats] = useState(null);
  const [cacheStatsLoading, setCacheStatsLoading] = useState(true);
  const noticeTimer = useRef(null);
  const saveNoticeTimer = useRef(null);
  const brandingSectionRef = useRef(null);
  const appOptionsSectionRef = useRef(null);
  const homeOptionsSectionRef = useRef(null);
  const maintenanceSectionRef = useRef(null);
  const mobileOptionsSectionRef = useRef(null);
  const brandingLogoInputRef = useRef(null);
  const ui = useMemo(() => getUiStrings(uiLanguage), [uiLanguage]);
  const languageOptions = useMemo(() => getSupportedLanguageOptions(ui), [ui]);

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
        ? ui.customization.retention.avatarCacheClearedWithCount.replace('{count}', res.data.removed)
        : ui.customization.retention.avatarCacheCleared;
      pushSaveNotice(
        'success',
        `${cacheCleared}. ${ui.customization.retention.avatarCacheReloadNotice}`
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
        ? ui.customization.retention.appIconCacheClearedWithCount.replace('{count}', res.data.removed)
        : ui.customization.retention.appIconCacheCleared;
      pushSaveNotice('success', `${message}. ${ui.customization.retention.appIconCacheReloadNotice}`);
    } catch (err) {
      pushSaveNotice('error', err.response?.data?.error || ui.admin.common.errorSaving);
    }
    setIconCacheCleaning(false);
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
      pushNotice('error', ui.customization.retention.logoTooLarge);
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
          ? `${ui.common.changesSaved}. ${ui.customization.retention.logRetentionNextCleanup}`
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

  const jumpTo = (ref) => {
    if (!ref.current) return;
    const offset = window.innerWidth >= 1280 ? 112 : 96;
    const top = ref.current.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  const sectionNav = [
    { label: ui.customization.login.title, ref: homeOptionsSectionRef, icon: LogIn },
    { label: ui.customization.home.title, ref: brandingSectionRef, icon: Home },
    { label: ui.customization.apps.title, ref: appOptionsSectionRef, icon: Settings },
    { label: ui.customization.retention.title, ref: maintenanceSectionRef, icon: Wrench },
    { label: ui.customization.mobile.title, ref: mobileOptionsSectionRef, icon: Smartphone },
  ];

  const renderSaveStatusBar = (key) => (
    <div key={key} className="mt-6 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-dark">{ui.common.changeStatus}</p>
          {saveNotice ? (
            <p className={`text-xs font-medium ${saveNotice.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
              {saveNotice.message}
            </p>
          ) : (
            <p className="text-xs text-gray-500">
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
          <h1 className="text-2xl font-extrabold text-dark">{ui.customization.title}</h1>
          <p className="text-gray-500 mt-1">{ui.customization.subtitle}</p>
        </div>
      </div>

      {pageNotice && (
        <div
          className={`mb-8 flex items-start gap-3 rounded-2xl border px-4 py-3 ${
            pageNotice.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
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
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
                <Clock3 className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-dark">{ui.customization.navigationTitle}</h2>
                <p className="text-xs text-gray-500">{ui.customization.navigationSubtitle}</p>
              </div>
            </div>
            <div className="flex xl:flex-col gap-2 overflow-x-auto pb-1 xl:pb-0">
              {sectionNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => jumpTo(item.ref)}
                    className="inline-flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-white min-w-[170px] xl:min-w-0"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-gray-500" />
                      {item.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 hidden xl:block" />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="flex flex-col gap-4">
          <div className="xl:hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
                <Clock3 className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-dark">{ui.customization.goToSection}</h2>
                <p className="text-xs text-gray-500">{ui.customization.navigationSubtitle}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {sectionNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => jumpTo(item.ref)}
                    className="inline-flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-white"
                  >
                    <Icon className="w-4 h-4 text-gray-500" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <section ref={homeOptionsSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                <LogIn className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">{ui.customization.login.title}</h2>
                <p className="text-sm text-gray-500">{ui.customization.login.subtitle}</p>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <input
                type="checkbox"
                checked={branding.hideLoginPage === true}
                onChange={(e) => setBranding({ ...branding, hideLoginPage: e.target.checked })}
                className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
              />
              <span>
                <span className="block text-sm font-medium text-gray-700">{ui.customization.login.hideLoginPageLabel}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.login.hideLoginPageHelp}</span>
              </span>
            </label>

            {renderSaveStatusBar('login')}
          </section>

          <section ref={brandingSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Home className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">{ui.customization.home.title}</h2>
                <p className="text-sm text-gray-500">{ui.customization.home.subtitle}</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                      <Type className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-dark">{ui.customization.home.textsTitle}</h3>
                      <p className="text-sm text-gray-500">{ui.customization.home.textsSubtitle}</p>
                    </div>
                  </div>

                  {brandingLoading ? (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-10 bg-gray-100 rounded-xl" />
                      <div className="h-10 bg-gray-100 rounded-xl" />
                      <div className="h-24 bg-gray-100 rounded-xl" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">{ui.customization.hero.line1}</label>
                        <input
                          type="text"
                          value={branding.heroTitleLine1}
                          onChange={(e) => setBranding({ ...branding, heroTitleLine1: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">{ui.customization.hero.line2}</label>
                        <input
                          type="text"
                          value={branding.heroTitleLine2}
                          onChange={(e) => setBranding({ ...branding, heroTitleLine2: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">{ui.customization.hero.subtitle}</label>
                        <textarea
                          rows="3"
                          value={branding.heroSubtitle}
                          onChange={(e) => setBranding({ ...branding, heroSubtitle: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                      <Image className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-dark">{ui.customization.home.logoTitle}</h3>
                      <p className="text-sm text-gray-500">{ui.customization.home.logoSubtitle}</p>
                    </div>
                  </div>

                  {brandingLoading ? (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-12 bg-gray-100 rounded-xl" />
                      <div className="h-24 bg-gray-100 rounded-2xl" />
                      <div className="h-10 bg-gray-100 rounded-xl" />
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
                          className="inline-flex items-center justify-center rounded-xl bg-accent/20 px-4 py-2.5 text-sm font-semibold text-dark transition-colors hover:bg-accent/30"
                        >
                          {ui.customization.home.chooseFile}
                        </button>
                        <span className="text-sm text-gray-500">
                          {brandingLogoFileName || ui.customization.home.noFileSelected}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {ui.customization.retention.assetFileHint}
                      </p>

                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 min-h-[150px] flex items-center justify-center">
                        {brandingLogoPreview ? (
                          <img
                            src={brandingLogoPreview}
                            alt={ui.customization.hero.selectedLogo}
                            className="max-h-24 max-w-[220px] object-contain"
                          />
                        ) : (
                          <div className="text-center text-gray-400">
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
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 rounded-xl font-semibold text-sm hover:bg-red-100 transition-colors"
                        >
                          {ui.customization.hero.removeLogo}
                        </button>
                        {branding.logoUrl && !removeBrandingLogo && (
                          <span className="text-xs text-gray-400">{ui.customization.hero.currentLogoActive}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-6">
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                    <Eye className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-dark">{ui.customization.home.previewTitle}</h2>
                    <p className="text-sm text-gray-500">{ui.customization.home.previewSubtitle}</p>
                  </div>
                </div>

                {brandingLoading ? (
                  <div className="h-[220px] rounded-2xl bg-gray-100 animate-pulse" />
                ) : (
                  <div className="rounded-2xl bg-gradient-to-br from-accent/20 via-white to-white p-4">
                    <div className="rounded-2xl bg-white/90 border border-white/80 p-4 md:p-5 min-h-[220px] flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                      <div className="min-w-0">
                        <div className="text-2xl md:text-3xl font-extrabold text-dark leading-tight">
                          {branding.heroTitleLine1}<br />
                          <span className="text-dark/70">{branding.heroTitleLine2}</span>
                        </div>
                        <p className="text-sm text-gray-500 mt-3 max-w-lg">{branding.heroSubtitle}</p>
                      </div>
                      <div className="flex items-center justify-center md:justify-end min-w-[160px]">
                        {brandingLogoPreview ? (
                          <img
                            src={brandingLogoPreview}
                            alt={ui.customization.hero.selectedLogo}
                            className="max-h-24 max-w-[180px] object-contain"
                          />
                        ) : (
                          <div className="w-28 h-28 rounded-2xl border border-dashed border-gray-200 flex items-center justify-center text-gray-300">
                            <Image className="w-8 h-8" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                  <input
                    type="checkbox"
                    checked={branding.showHomeHero !== false}
                    onChange={(e) => setBranding({ ...branding, showHomeHero: e.target.checked })}
                    className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-700">{ui.customization.home.heroLabel}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.home.heroHelp}</span>
                  </span>
                </label>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gray-900/5 flex items-center justify-center">
                      <Eye className="w-4 h-4 text-gray-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label htmlFor="home-desktop-view" className="block text-sm font-medium text-gray-700">
                        {ui.customization.home.desktopViewLabel}
                      </label>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {ui.customization.home.desktopViewHelp}
                      </p>
                      <select
                        id="home-desktop-view"
                        value={branding.defaultHomeDesktopView}
                        onChange={(e) => setBranding({ ...branding, defaultHomeDesktopView: e.target.value })}
                        className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-accent focus:ring-accent disabled:opacity-60"
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

          <section ref={appOptionsSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                <Settings className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">{ui.customization.apps.title}</h2>
                <p className="text-sm text-gray-500">{ui.customization.apps.subtitle}</p>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <input
                type="checkbox"
                checked={branding.showAppModeBadges !== false}
                onChange={(e) => setBranding({ ...branding, showAppModeBadges: e.target.checked })}
                className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
              />
              <span>
                <span className="block text-sm font-medium text-gray-700">{ui.customization.apps.badgesLabel}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.apps.badgesHelp}</span>
              </span>
            </label>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.showSharedCookieMode !== false}
                  onChange={(e) => setBranding({ ...branding, showSharedCookieMode: e.target.checked })}
                  className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700">{ui.customization.apps.sharedCookieLabel}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.apps.sharedCookieHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.showRedirectSsoMode !== false}
                  onChange={(e) => setBranding({ ...branding, showRedirectSsoMode: e.target.checked })}
                  className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700">{ui.customization.apps.redirectLabel}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.apps.redirectHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.showEntraAppMode !== false}
                  onChange={(e) => setBranding({ ...branding, showEntraAppMode: e.target.checked })}
                  className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700">{ui.customization.apps.entraLabel}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.apps.entraHelp}</span>
                </span>
              </label>
            </div>

            {renderSaveStatusBar('app')}
          </section>

          <section ref={maintenanceSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Wrench className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">{ui.customization.retention.title}</h2>
                <p className="text-sm text-gray-500">{ui.customization.retention.subtitle}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-dark">{ui.customization.retention.languageTitle}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{ui.customization.retention.languageHelp}</p>
                  </div>
                  <select
                    value={branding.defaultLanguage || 'en'}
                    onChange={(e) => setBranding({ ...branding, defaultLanguage: normalizeLanguage(e.target.value) })}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-accent focus:ring-accent lg:w-72"
                  >
                    {languageOptions.map((language) => (
                      <option key={language.code} value={language.code}>{language.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.use24hTimeFormat === true}
                  onChange={(e) => setBranding({ ...branding, use24hTimeFormat: e.target.checked })}
                  className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-700">{ui.customization.retention.timeFormatTitle}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.retention.timeFormatHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.useEuropeanDateFormat === true}
                  onChange={(e) => setBranding({ ...branding, useEuropeanDateFormat: e.target.checked })}
                  className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-700">{ui.customization.retention.dateFormatTitle}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.retention.dateFormatHelp}</span>
                </span>
              </label>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-dark">{ui.customization.retention.avatarCacheTitle}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{ui.customization.retention.avatarCacheHelp}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {cacheStatsLoading ? ui.common.loading : `${cacheStats?.avatarCache?.files || 0} ${ui.customization.retention.cacheFiles} · ${formatBytes(cacheStats?.avatarCache?.bytes || 0)}`}
                    </p>
                  </div>
                  <div className="flex items-start lg:shrink-0">
                    <button
                      type="button"
                      onClick={() => openConfirm({
                        title: ui.customization.retention.refreshAvatarCacheConfirmTitle,
                        message: ui.customization.retention.refreshAvatarCacheConfirmMessage,
                        confirmLabel: ui.customization.retention.refreshAvatarCacheConfirmLabel,
                        onConfirm: refreshAvatarCache,
                      })}
                      disabled={avatarRefreshing}
                      className="inline-flex min-w-[212px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {avatarRefreshing ? ui.customization.retention.refreshAvatarCacheBusy : ui.customization.retention.refreshAvatarCache}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-dark">{ui.customization.retention.appIconCacheTitle}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{ui.customization.retention.appIconCacheHelp}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {cacheStatsLoading ? ui.common.loading : `${cacheStats?.appIconCache?.totalFiles || 0} ${ui.customization.retention.cacheFiles} · ${formatBytes(cacheStats?.appIconCache?.totalBytes || 0)} · ${cacheStats?.appIconCache?.orphanFiles || 0} ${ui.customization.retention.cacheOrphans}`}
                    </p>
                  </div>
                  <div className="flex items-start lg:shrink-0">
                    <button
                      type="button"
                      onClick={() => openConfirm({
                        title: ui.customization.retention.refreshAppIconCacheConfirmTitle,
                        message: ui.customization.retention.refreshAppIconCacheConfirmMessage,
                        confirmLabel: ui.customization.retention.refreshAppIconCacheConfirmLabel,
                        onConfirm: cleanupAppIconCache,
                      })}
                      disabled={iconCacheCleaning}
                      className="inline-flex min-w-[212px] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {iconCacheCleaning ? ui.customization.retention.refreshAppIconCacheBusy : ui.customization.retention.refreshAppIconCache}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm font-semibold text-dark">{ui.customization.retention.logRetentionTitle}</p>
                      <div className={`rounded-full px-3 py-1 text-xs font-semibold ${branding.logRetentionDays === 0 ? 'bg-red-100 text-red-700' : 'bg-white text-amber-700'}`}>
                        {branding.logRetentionDays === 0 ? ui.customization.retention.logless : `${branding.logRetentionDays} ${ui.common.days}`}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{ui.customization.retention.logRetentionHelp}</p>
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
                      className="w-full accent-amber-500"
                    />

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>0 = {ui.customization.retention.logless}</span>
                      <span>90 = {ui.customization.retention.recommended}</span>
                    </div>

                    <p className="rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800 leading-6">
                      {ui.customization.retention.logRetentionNotice}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 h-24 rounded-2xl bg-gray-100 animate-pulse" />
                )}
              </div>
            </div>

            {renderSaveStatusBar('maintenance')}
          </section>

          <section ref={mobileOptionsSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-cyan-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">{ui.customization.mobile.title}</h2>
                <p className="text-sm text-gray-500">{ui.customization.mobile.subtitle}</p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.defaultCompactView === true}
                  onChange={(e) => setBranding({ ...branding, defaultCompactView: e.target.checked })}
                  className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700">{ui.customization.mobile.compactLabel}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.mobile.compactHelp}</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                <input
                  type="checkbox"
                  checked={branding.hideHomeHeroOnMobile === true}
                  onChange={(e) => setBranding({ ...branding, hideHomeHeroOnMobile: e.target.checked })}
                  className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-700">{ui.customization.mobile.hideHeroLabel}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{ui.customization.mobile.hideHeroHelp}</span>
                </span>
              </label>
            </div>

            {renderSaveStatusBar('mobile')}
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
