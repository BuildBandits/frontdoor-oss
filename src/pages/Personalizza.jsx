import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, Eye, Home, Image, LayoutPanelLeft, LogIn, RefreshCw, Save, Settings, SlidersHorizontal, Type } from 'lucide-react';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';

const emptyBranding = {
  heroTitleLine1: 'Le tue applicazioni,',
  heroTitleLine2: 'tutte in un unico posto.',
  heroSubtitle: 'Accedi rapidamente a tutti gli strumenti e le piattaforme del tuo workspace.',
  showHomeHero: true,
  showAppModeBadges: true,
  defaultCompactView: false,
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
  'showAppModeBadges',
  'defaultCompactView',
  'logRetentionDays',
  'hideLoginPage',
  'showSharedCookieMode',
  'showRedirectSsoMode',
  'showEntraAppMode',
];

export default function Personalizza() {
  const [branding, setBranding] = useState(emptyBranding);
  const [initialBranding, setInitialBranding] = useState(emptyBranding);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingLogoDataUrl, setBrandingLogoDataUrl] = useState('');
  const [brandingLogoPreview, setBrandingLogoPreview] = useState(null);
  const [removeBrandingLogo, setRemoveBrandingLogo] = useState(false);
  const [pageNotice, setPageNotice] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [avatarRefreshing, setAvatarRefreshing] = useState(false);
  const noticeTimer = useRef(null);
  const saveNoticeTimer = useRef(null);
  const brandingSectionRef = useRef(null);
  const appOptionsSectionRef = useRef(null);
  const homeOptionsSectionRef = useRef(null);
  const maintenanceSectionRef = useRef(null);

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

  const loadBranding = () => {
    setBrandingLoading(true);
    api.get('/branding')
      .then((res) => {
        const next = res.data.branding || emptyBranding;
        setBranding(next);
        setInitialBranding(next);
        setBrandingLogoPreview(next.logoUrl || null);
        setBrandingLogoDataUrl('');
        setRemoveBrandingLogo(false);
      })
      .catch(() => {
        setBranding(emptyBranding);
        setInitialBranding(emptyBranding);
        setBrandingLogoPreview(null);
      })
      .finally(() => setBrandingLoading(false));
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
      pushSaveNotice(
        'success',
        `Cache avatar svuotata${res.data?.removed ? ` (${res.data.removed} file rimossi)` : ''}. Gli avatar verranno ricaricati alla prossima visualizzazione.`
      );
    } catch (err) {
      pushSaveNotice('error', err.response?.data?.error || 'Errore nello svuotamento della cache avatar');
    }
    setAvatarRefreshing(false);
  };

  useEffect(() => {
    loadBranding();
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
    };
  }, []);

  const handleBrandingLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      pushNotice('error', 'Il logo deve essere al massimo 2 MB.');
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
        showAppModeBadges: branding.showAppModeBadges,
        defaultCompactView: branding.defaultCompactView,
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
      setBrandingLogoPreview(next.logoUrl || null);
      setBrandingLogoDataUrl('');
      setRemoveBrandingLogo(false);
      pushSaveNotice(
        'success',
        retentionChanged
          ? `${res.data.message || 'Modifiche salvate'}. La nuova conservazione dei log si applicherà al prossimo ciclo di pulizia.`
          : res.data.message || 'Modifiche salvate'
      );
    } catch (err) {
      pushSaveNotice('error', err.response?.data?.error || 'Errore nel salvataggio del branding');
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
    { label: 'Login', ref: homeOptionsSectionRef, icon: LogIn },
    { label: 'Home', ref: brandingSectionRef, icon: Home },
    { label: 'App', ref: appOptionsSectionRef, icon: Settings },
    { label: 'Criteri', ref: maintenanceSectionRef, icon: Clock3 },
  ];

  return (
    <div className="pb-24">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">Personalizza</h1>
          <p className="text-gray-500 mt-1">Personalizza Frontdoor in base alle tue esigenze</p>
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
                <LayoutPanelLeft className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-dark">Impostazioni</h2>
                <p className="text-xs text-gray-500">Navigazione rapida</p>
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
                <LayoutPanelLeft className="w-4 h-4 text-slate-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-dark">Vai alla sezione</h2>
                <p className="text-xs text-gray-500">Navigazione rapida</p>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sectionNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => jumpTo(item.ref)}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-white min-w-[150px]"
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
                <h2 className="text-lg font-bold text-dark">Login</h2>
                <p className="text-sm text-gray-500">Controlli dedicati all&apos;accesso iniziale.</p>
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
                <span className="block text-sm font-medium text-gray-700">Vai subito alla Login SSO</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Disattivando la pagina di login, l&apos;utente viene portato direttamente all&apos;autenticazione Microsoft e poi alla Home.
                </span>
              </span>
            </label>
          </section>

          <section ref={brandingSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Home className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">Home</h2>
                <p className="text-sm text-gray-500">Testi, logo, anteprima e comportamento della Home.</p>
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
                      <h3 className="text-lg font-bold text-dark">Testi</h3>
                      <p className="text-sm text-gray-500">Titolo e sottotitolo della Home.</p>
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
                        <label className="block text-sm font-medium text-gray-600 mb-1">Titolo hero, prima riga</label>
                        <input
                          type="text"
                          value={branding.heroTitleLine1}
                          onChange={(e) => setBranding({ ...branding, heroTitleLine1: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Titolo hero, seconda riga</label>
                        <input
                          type="text"
                          value={branding.heroTitleLine2}
                          onChange={(e) => setBranding({ ...branding, heroTitleLine2: e.target.value })}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Sottotitolo hero</label>
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
                      <h3 className="text-lg font-bold text-dark">Logo aziendale</h3>
                      <p className="text-sm text-gray-500">Carica, sostituisci o rimuovi il logo della Home.</p>
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
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
                        onChange={handleBrandingLogoChange}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-accent file:text-white file:font-semibold hover:file:bg-accent/90"
                      />
                      <p className="text-xs text-gray-400">PNG, JPG, WEBP, GIF o SVG. Max 2 MB.</p>

                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 min-h-[150px] flex items-center justify-center">
                        {brandingLogoPreview ? (
                          <img
                            src={brandingLogoPreview}
                            alt="Logo selezionato"
                            className="max-h-24 max-w-[220px] object-contain"
                          />
                        ) : (
                          <div className="text-center text-gray-400">
                            <Image className="w-8 h-8 mx-auto mb-2" />
                            <p className="text-xs">Nessun logo selezionato</p>
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
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 rounded-xl font-semibold text-sm hover:bg-red-100 transition-colors"
                        >
                          Rimuovi logo
                        </button>
                        {branding.logoUrl && !removeBrandingLogo && (
                          <span className="text-xs text-gray-400">Logo attuale attivo</span>
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
                    <h2 className="text-lg font-bold text-dark">Anteprima</h2>
                    <p className="text-sm text-gray-500">Controlla subito l&apos;effetto finale.</p>
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
                            alt="Logo anteprima"
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
                    <span className="block text-sm font-medium text-gray-700">Mostra banner hero nella Home</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Disattivalo per nascondere completamente il banner grande nella Home e lasciare più spazio alle applicazioni.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 opacity-60">
                  <input
                    type="checkbox"
                    checked={branding.defaultCompactView === true}
                    onChange={(e) => setBranding({ ...branding, defaultCompactView: e.target.checked })}
                    className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-700">Visualizzazione applicazioni compatta di default</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      In pausa. La terremo come opzione globale, ma per ora non è il focus della personalizzazione.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section ref={appOptionsSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                <Settings className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">Gestione App</h2>
                <p className="text-sm text-gray-500">Controlli che influenzano il catalogo e la gestione delle app.</p>
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
                <span className="block text-sm font-medium text-gray-700">Mostra badge ext / SSO sulle app</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Disattivalo se vuoi una griglia più pulita e senza indicatori di modalità nelle card.
                </span>
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
                  <span className="block text-sm font-medium text-gray-700">Mostra Shared Cookie</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Disattivalo per nascondere la modalità Shared Cookie nelle app.
                  </span>
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
                  <span className="block text-sm font-medium text-gray-700">Mostra Redirect SSO</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Disattivalo per nascondere la modalità Redirect SSO nelle app.
                  </span>
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
                  <span className="block text-sm font-medium text-gray-700">Mostra Entra App</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Disattivalo per nascondere la modalità Entra App nelle app.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section ref={maintenanceSectionRef} className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <SlidersHorizontal className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-dark">Criteri di conservazione</h2>
                <p className="text-sm text-gray-500">Conservazione dei log, cache avatar e manutenzioni periodiche della piattaforma.</p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-5">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-sm font-semibold text-dark">Conservazione log</p>
                    <p className="text-xs text-gray-500">Definisci per quanti giorni mantenere Log e Audit nel database.</p>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs font-semibold ${branding.logRetentionDays === 0 ? 'bg-red-100 text-red-700' : 'bg-white text-amber-700'}`}>
                    {branding.logRetentionDays === 0 ? 'Logless' : `${branding.logRetentionDays} giorni`}
                  </div>
                </div>

                {!brandingLoading ? (
                  <div className="space-y-4">
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
                      <span>0 = logless</span>
                      <span>90 = default consigliato</span>
                    </div>

                    <p className="rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800 leading-6">
                      La modifica non elimina subito i record: la pulizia avverrà al prossimo ciclo automatico, così hai tempo di tornare indietro se serve.
                    </p>
                  </div>
                ) : (
                  <div className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
                )}
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-5">
                <div>
                  <p className="text-sm font-semibold text-dark">Cache avatar</p>
                  <p className="text-xs text-gray-500">Se cambi l&apos;immagine profilo in Microsoft 365 e vuoi vederla subito
                   in Frontdoor, puoi invalidare la cache degli avatar salvati sul server e nel browser. Al prossimo caricamento i profili verranno richiesti di nuovo.</p>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openConfirm({
                      title: 'Svuotare la cache avatar utenti?',
                      message: 'La cache server e quella del browser verranno invalidate. Gli avatar saranno ricaricati al prossimo accesso o refresh della pagina.',
                      confirmLabel: 'Svuota cache',
                      onConfirm: refreshAvatarCache,
                    })}
                    disabled={avatarRefreshing}
                    className="inline-flex items-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${avatarRefreshing ? 'animate-spin' : ''}`} />
                    {avatarRefreshing ? 'Svuotamento...' : 'Aggiorna avatar utenti'}
                  </button>
                  <span className="text-xs text-amber-700">
                    Utile se vuoi ricaricare subito avatar Microsoft o Gravatar aggiornati.
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-5xl -translate-x-1/2">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-lg shadow-black/10 backdrop-blur">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-dark">Stato modifiche</p>
            {saveNotice ? (
              <p className={`text-xs font-medium ${saveNotice.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
                {saveNotice.message}
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                {isDirty ? 'Hai modifiche non salvate' : 'Nessuna modifica in sospeso'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSaveBranding}
            disabled={brandingSaving || !isDirty}
            className="inline-flex items-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {brandingSaving ? 'Salvataggio...' : 'Salva modifiche'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || 'Conferma'}
        cancelLabel={confirmDialog?.cancelLabel || 'Annulla'}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
}
