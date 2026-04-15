import { useState, useEffect, useRef } from 'react';
import { Save, RefreshCw, Image, CheckCircle2, AlertCircle, Palette, Type, Eye, SlidersHorizontal } from 'lucide-react';
import api from '../services/api';

const emptyBranding = {
  heroTitleLine1: 'Le tue applicazioni,',
  heroTitleLine2: 'tutte in un unico posto.',
  heroSubtitle: 'Accedi rapidamente a tutti gli strumenti e le piattaforme del tuo workspace.',
  showAppModeBadges: true,
  defaultCompactView: false,
  showSharedCookieMode: true,
  showRedirectSsoMode: true,
  showEntraAppMode: true,
};

export default function Personalizza() {
  const [branding, setBranding] = useState(emptyBranding);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingLogoDataUrl, setBrandingLogoDataUrl] = useState('');
  const [brandingLogoPreview, setBrandingLogoPreview] = useState(null);
  const [removeBrandingLogo, setRemoveBrandingLogo] = useState(false);
  const [pageNotice, setPageNotice] = useState(null);
  const noticeTimer = useRef(null);

  const pushNotice = (type, message) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setPageNotice({ type, message });
    noticeTimer.current = setTimeout(() => {
      setPageNotice(null);
      noticeTimer.current = null;
    }, 4500);
  };

  const loadBranding = () => {
    setBrandingLoading(true);
    api.get('/branding')
      .then((res) => {
        const next = res.data.branding || emptyBranding;
        setBranding(next);
        setBrandingLogoPreview(next.logoUrl || null);
        setBrandingLogoDataUrl('');
        setRemoveBrandingLogo(false);
      })
      .catch(() => {
        setBranding(emptyBranding);
        setBrandingLogoPreview(null);
      })
      .finally(() => setBrandingLoading(false));
  };

  useEffect(() => {
    loadBranding();
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
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
      const payload = {
        heroTitleLine1: branding.heroTitleLine1,
        heroTitleLine2: branding.heroTitleLine2,
        heroSubtitle: branding.heroSubtitle,
        showAppModeBadges: branding.showAppModeBadges,
        defaultCompactView: branding.defaultCompactView,
        showSharedCookieMode: branding.showSharedCookieMode,
        showRedirectSsoMode: branding.showRedirectSsoMode,
        showEntraAppMode: branding.showEntraAppMode,
        ...(removeBrandingLogo ? { removeLogo: true } : {}),
        ...(brandingLogoDataUrl ? { logoDataUrl: brandingLogoDataUrl } : {}),
      };

      const res = await api.put('/branding', payload);
      const next = res.data.branding || emptyBranding;
      setBranding(next);
      setBrandingLogoPreview(next.logoUrl || null);
      setBrandingLogoDataUrl('');
      setRemoveBrandingLogo(false);
      pushNotice('success', res.data.message || 'Modifiche salvate');
    } catch (err) {
      pushNotice('error', err.response?.data?.error || 'Errore nel salvataggio del branding');
    }
    setBrandingSaving(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">Personalizza</h1>
          <p className="text-gray-500 mt-1">Home, logo e controlli di visualizzazione delle app</p>
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

      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Palette className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-dark">Branding home</h2>
            <p className="text-sm text-gray-500">Testi, logo e anteprima della parte pubblica.</p>
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
                  <h3 className="text-lg font-bold text-dark">Testi home</h3>
                  <p className="text-sm text-gray-500">Titolo e sottotitolo della home.</p>
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

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSaveBranding}
                      disabled={brandingSaving}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      Salva modifiche
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBranding(emptyBranding);
                        setBrandingLogoDataUrl('');
                        setBrandingLogoPreview(null);
                        setRemoveBrandingLogo(false);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-dark border border-gray-200 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Ripristina valori iniziali
                    </button>
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
                  <p className="text-sm text-gray-500">Carica, sostituisci o rimuovi il logo della home.</p>
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
              <div className="h-[260px] rounded-2xl bg-gray-100 animate-pulse" />
            ) : (
              <div className="rounded-2xl bg-gradient-to-br from-accent/20 via-white to-white p-4">
                <div className="rounded-2xl bg-white/90 border border-white/80 p-5 min-h-[260px] flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                  <div className="min-w-0">
                    <div className="text-3xl font-extrabold text-dark leading-tight">
                      {branding.heroTitleLine1}<br />
                      <span className="text-dark/70">{branding.heroTitleLine2}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-4 max-w-lg">{branding.heroSubtitle}</p>
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
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <SlidersHorizontal className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-dark">Opzioni aggiuntive</h2>
            <p className="text-sm text-gray-500">Qui raccoglieremo le impostazioni extra della personalizzazione.</p>
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

        <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 mt-3 opacity-60">
          <input
            type="checkbox"
            checked={branding.defaultCompactView === true}
            onChange={(e) => setBranding({ ...branding, defaultCompactView: e.target.checked })}
            className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
          />
          <span>
            <span className="block text-sm font-medium text-gray-700">Home compatta di default</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              In pausa. La terremo come opzione globale, ma per ora non è il focus della personalizzazione.
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
      </div>
    </div>
  );
}
