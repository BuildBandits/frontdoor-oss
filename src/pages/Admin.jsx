import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Pencil, Trash2, X, RefreshCw, Save } from 'lucide-react';
import api from '../services/api';
import TagInput from '../components/TagInput';
import AppIcon from '../components/AppIcon';

const emptyApp = { name: '', slug: '', description: '', long_description: '', icon: '📦', target_url: '', sort_order: 0, mode: 'redirect-plain', sso_endpoint: '/sso', sso_method: 'GET', tags: [] };

export default function Admin() {
  const [apps, setApps] = useState([]);
  const [groups, setGroups] = useState([]);
  const [branding, setBranding] = useState(null);
  const [editing, setEditing] = useState(null); // null = closed, 'new' = creating, or app object
  const [form, setForm] = useState(emptyApp);
  const [loading, setLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [iconMode, setIconMode] = useState('emoji');
  const [iconAssetDataUrl, setIconAssetDataUrl] = useState('');
  const [iconAssetPreview, setIconAssetPreview] = useState('');
  const [iconSvgText, setIconSvgText] = useState('');
  const [removeIconAsset, setRemoveIconAsset] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [groupSearch, setGroupSearch] = useState('');
  const iconFileInputRef = useRef(null);

  const loadApps = () => {
    api.get('/apps/all').then((res) => {
      setApps(res.data.apps);
      setLoading(false);
    });
  };

  const loadGroups = () => {
    api.get('/groups').then((res) => {
      setGroups(Array.isArray(res.data.groups) ? res.data.groups : []);
    }).catch(() => {
      setGroups([]);
    }).finally(() => {
      setGroupsLoading(false);
    });
  };

  const loadBranding = () => {
    api.get('/branding')
      .then((res) => setBranding(res.data.branding || null))
      .catch(() => setBranding(null));
  };

  useEffect(() => {
    loadApps();
    loadGroups();
    loadBranding();
  }, []);

  const openNew = () => {
    setForm(emptyApp);
    setIconMode('emoji');
    setIconAssetDataUrl('');
    setIconAssetPreview('');
    setIconSvgText('');
    setRemoveIconAsset(false);
    setSelectedGroupIds([]);
    setGroupSearch('');
    setEditing('new');
  };

  const openEdit = (app) => {
    setForm({
      name: app.name,
      slug: app.slug,
      description: app.description || '',
      icon: app.icon || '📦',
      target_url: app.target_url,
      sort_order: app.sort_order || 0,
      mode: app.mode || 'redirect-plain',
      sso_endpoint: app.sso_endpoint || '/sso',
      sso_method: app.sso_method || 'GET',
      long_description: app.long_description || '',
      tags: Array.isArray(app.tags) ? app.tags : (typeof app.tags === 'string' ? JSON.parse(app.tags || '[]') : []),
    });
    setIconMode(app.iconUrl ? 'asset' : 'emoji');
    setIconAssetPreview(app.iconUrl || '');
    setIconAssetDataUrl('');
    setIconSvgText('');
    setRemoveIconAsset(false);
    setSelectedGroupIds([]);
    setGroupSearch('');
    setEditing(app);
  };

  const close = () => {
    setEditing(null);
    setForm(emptyApp);
    setIconMode('emoji');
    setIconAssetDataUrl('');
    setIconAssetPreview('');
    setIconSvgText('');
    setRemoveIconAsset(false);
    setSelectedGroupIds([]);
    setGroupSearch('');
  };

  const applyIconAssetFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setIconMode('asset');
      setIconAssetDataUrl(dataUrl);
      setIconAssetPreview(dataUrl);
      setIconSvgText('');
      setRemoveIconAsset(false);
    };
    reader.readAsDataURL(file);
  };

  const handleIconFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) applyIconAssetFile(file);
    event.target.value = '';
  };

  const handleIconPaste = (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        applyIconAssetFile(file);
        event.preventDefault();
      }
      return;
    }

    const pastedText = event.clipboardData?.getData('text/plain') || '';
    if (/<svg[\s>]/i.test(pastedText)) {
      const svg = pastedText.trim();
      setIconMode('asset');
      setIconSvgText(svg);
      setIconAssetDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      setIconAssetPreview(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      setRemoveIconAsset(false);
      event.preventDefault();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (iconMode === 'asset' && !iconAssetDataUrl && !iconSvgText && !iconAssetPreview && editing === 'new') {
        throw new Error('Carica o incolla un\'immagine/SVG per l\'icona, oppure torna alla modalità emoji');
      }

      const iconPayload = iconMode === 'asset'
        ? {
            iconDataUrl: iconAssetDataUrl || undefined,
            iconSvgText: iconSvgText || undefined,
            removeIconAsset: removeIconAsset || undefined,
          }
        : {
            removeIconAsset: editing !== 'new' && Boolean(editing.iconUrl) ? true : undefined,
          };

      if (editing === 'new') {
        await api.post('/apps', {
          ...form,
          ...iconPayload,
          icon: iconMode === 'emoji' ? form.icon : form.icon || '🖼️',
          groupIds: selectedGroupIds,
        });
      } else {
        await api.put(`/apps/${editing.id}`, {
          ...form,
          ...iconPayload,
          icon: iconMode === 'emoji' ? form.icon : form.icon || '🖼️',
        });
      }
      loadApps();
      close();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Errore nel salvataggio');
    }
    setSaving(false);
  };

  const handleDelete = async (app) => {
    if (!confirm(`Eliminare "${app.name}"? Questa azione non è reversibile.`)) return;
    try {
      await api.delete(`/apps/${app.id}`);
      loadApps();
    } catch (err) {
      alert(err.response?.data?.error || 'Errore nella cancellazione');
    }
  };

  const handleToggle = async (app) => {
    try {
      await api.put(`/apps/${app.id}`, { is_active: app.is_active ? 0 : 1 });
      loadApps();
    } catch (err) {
      alert(err.response?.data?.error || 'Errore');
    }
  };

  const handleRestoreDefaults = async () => {
    if (!confirm('Ripristinare le demo app di default? Le app con gli stessi slug verranno riportate ai valori base.')) {
      return;
    }

    setRestoringDefaults(true);
    try {
      const res = await api.post('/apps/restore-defaults');
      loadApps();
      alert(`${res.data.message}. Create: ${res.data.created}, aggiornate: ${res.data.updated}.`);
    } catch (err) {
      alert(err.response?.data?.error || 'Errore nel ripristino delle demo app');
    }
    setRestoringDefaults(false);
  };

  const groupLabel = (group) => group.entra_display_name || group.name;
  const groupMatchesSearch = (group) => {
    if (!groupSearch.trim()) return true;
    const q = groupSearch.toLowerCase();
    return groupLabel(group).toLowerCase().includes(q) || (group.description || '').toLowerCase().includes(q) || (group.source || '').toLowerCase().includes(q);
  };
  const filteredGroups = groups.filter(groupMatchesSearch);
  const allTags = useMemo(() => {
    const tagSet = new Set();
    apps.forEach((app) => {
      (Array.isArray(app.tags) ? app.tags : []).forEach((tag) => {
        const normalized = (tag ?? '').toString().trim().toLowerCase();
        if (normalized) tagSet.add(normalized);
      });
    });
    return [...tagSet].sort();
  }, [apps]);
  const toggleGroupSelection = (groupId) => {
    setSelectedGroupIds((prev) => (
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    ));
  };
  const modeVisibility = branding || {
    showSharedCookieMode: true,
    showRedirectSsoMode: true,
    showEntraAppMode: true,
  };
  const modeOptions = [
    { value: 'redirect-plain', label: 'Link esterno', active: 'bg-dark text-white border-dark', alwaysVisible: true },
    { value: 'shared-cookie', label: 'Shared Cookie', active: 'bg-emerald-600 text-white border-emerald-600', visible: modeVisibility.showSharedCookieMode !== false },
    { value: 'redirect', label: 'Redirect SSO', active: 'bg-blue-600 text-white border-blue-600', visible: modeVisibility.showRedirectSsoMode !== false },
    { value: 'entra-app', label: 'Entra App', active: 'bg-violet-600 text-white border-violet-600', visible: modeVisibility.showEntraAppMode !== false },
  ];
  const visibleModeOptions = modeOptions.filter((opt) => opt.alwaysVisible || opt.visible);
  const currentModeOption = modeOptions.find((opt) => opt.value === form.mode);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-dark">Gestione App</h1>
          <p className="text-gray-500 mt-1">Aggiungi, modifica o rimuovi applicazioni dal catalogo</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuova app
        </button>
      </div>

      {/* App table */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-xl border border-gray-100" />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">App</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Slug</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Target URL</th>
                <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Modo</th>
                <th className="text-center px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Attiva</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <AppIcon app={app} className="w-8 h-8" textClassName="text-2xl" />
                      <span className="font-semibold text-dark">{app.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{app.slug}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-[200px]">{app.target_url}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      app.mode === 'redirect' ? 'bg-blue-100 text-blue-700'
                        : app.mode === 'shared-cookie' ? 'bg-emerald-100 text-emerald-700'
                        : app.mode === 'entra-app' ? 'bg-violet-100 text-violet-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {app.mode === 'redirect' ? 'SSO' : app.mode === 'shared-cookie' ? 'cookie' : app.mode === 'entra-app' ? 'entra' : 'link'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleToggle(app)}
                      className={`w-10 h-6 rounded-full transition-colors relative inline-flex items-center ${
                        app.is_active ? 'bg-accent' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`absolute w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          app.is_active ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(app)}
                        className="p-2 text-gray-400 hover:text-dark hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(app)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/60">
            <button
              onClick={handleRestoreDefaults}
              disabled={restoringDefaults}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-gray-200 bg-white text-gray-600 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${restoringDefaults ? 'animate-spin' : ''}`} />
              Ripristina applicazioni dimostrative
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {editing !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-6xl shadow-xl my-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-dark">
                {editing === 'new' ? 'Nuova App' : 'Modifica App'}
              </h2>
              <button onClick={close} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Icona</label>
                    <p className="text-xs text-gray-400">
                      Emoji classica oppure immagine / SVG incollati da file, clipboard o sito esterno.
                    </p>
                  </div>
                  <div className="flex items-center rounded-xl border border-gray-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIconMode('emoji');
                        setIconAssetDataUrl('');
                        setIconAssetPreview('');
                        setIconSvgText('');
                        setRemoveIconAsset(Boolean(editing && editing !== 'new' && editing.iconUrl));
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        iconMode === 'emoji' ? 'bg-dark text-white' : 'text-gray-500 hover:text-dark'
                      }`}
                    >
                      Usa emoji
                    </button>
                    <button
                      type="button"
                      onClick={() => setIconMode('asset')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        iconMode === 'asset' ? 'bg-dark text-white' : 'text-gray-500 hover:text-dark'
                      }`}
                    >
                      Usa immagine
                    </button>
                  </div>
                </div>

                {iconMode === 'emoji' ? (
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr] items-center">
                    <div className="w-16 h-16 rounded-2xl border border-gray-200 bg-white flex items-center justify-center">
                      <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">Emoji o simbolo</label>
                      <input
                        type="text"
                        value={form.icon}
                        onChange={(e) => setForm({ ...form, icon: e.target.value })}
                        placeholder="📦"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[180px_1fr] items-start">
                    <div
                      role="button"
                      tabIndex={0}
                      onPaste={handleIconPaste}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer?.files?.[0];
                        if (file) applyIconAssetFile(file);
                      }}
                      onClick={() => iconFileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          iconFileInputRef.current?.click();
                        }
                      }}
                      className="rounded-2xl border-2 border-dashed border-gray-200 bg-white px-4 py-4 text-center cursor-pointer hover:border-accent transition-colors outline-none min-h-[180px] flex flex-col items-center justify-center gap-3"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center overflow-hidden">
                        {iconAssetPreview ? (
                          <img src={iconAssetPreview} alt="Anteprima icona" className="w-full h-full object-contain" />
                        ) : (
                          <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-dark">Clicca, incolla o trascina un file</p>
                        <p className="text-xs text-gray-400">PNG, JPG, WEBP, GIF, SVG o immagini copiate negli appunti</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <input
                        ref={iconFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml"
                        onChange={handleIconFileChange}
                        className="hidden"
                      />

                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Oppure incolla SVG</label>
                        <textarea
                          value={iconSvgText}
                          onChange={(e) => {
                            const svg = e.target.value;
                            setIconSvgText(svg);
                            setIconAssetPreview(/<svg[\s>]/i.test(svg)
                              ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`
                              : '');
                            setIconAssetDataUrl('');
                            setRemoveIconAsset(false);
                          }}
                          placeholder="<svg ...>...</svg>"
                          rows={4}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                        />
                      </div>

                      {iconAssetPreview && (
                        <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
                          <span>Anteprima icona caricata</span>
                          <button
                            type="button"
                            onClick={() => {
                              setIconAssetDataUrl('');
                              setIconAssetPreview('');
                              setIconSvgText('');
                              setRemoveIconAsset(true);
                            }}
                            className="text-red-600 hover:text-red-700 font-semibold"
                          >
                            Rimuovi immagine
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-gray-400">
                        Suggerimento: puoi anche incollare qui con <span className="font-semibold">Ctrl+V</span> un&apos;immagine copiata o un blocco SVG.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Nome</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ProfileFit"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Slug (subdomain)</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  placeholder="profilefit"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Descrizione</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Quiz di profilazione e formazione gruppi"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Target URL</label>
                <input
                  type="url"
                  value={form.target_url}
                  onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                  placeholder="https://myapp.example.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

                {editing === 'new' && (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">Gruppi di visibilità</label>
                      <p className="text-xs text-gray-400">
                        Seleziona uno o pi&ugrave; gruppi di Frontdoor. L&apos;app non viene più assegnata automaticamente a <span className="font-semibold">default</span>.
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {selectedGroupIds.length} selezionati
                    </span>
                  </div>

                  <input
                    type="text"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Cerca gruppo..."
                    className="w-full px-3 py-2.5 mb-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />

                    {groupsLoading ? (
                      <div className="animate-pulse grid gap-2 sm:grid-cols-2">
                        {[...Array(4)].map((_, i) => (
                          <div key={i} className="h-16 rounded-xl bg-white border border-gray-100" />
                        ))}
                      </div>
                    ) : filteredGroups.length === 0 ? (
                      <div className="text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-200 px-3 py-4">
                        Nessun gruppo trovato.
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 max-h-[520px] overflow-y-auto pr-1">
                        {filteredGroups.map((group) => {
                        const selected = selectedGroupIds.includes(group.id);
                        const groupSourceLabel = group.source === 'entra' ? 'Entra' : 'Locale';
                        return (
                          <label
                            key={group.id}
                            className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                              selected ? 'border-accent bg-accent/5' : 'border-gray-200 bg-white hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleGroupSelection(group.id)}
                              className="mt-1 rounded border-gray-300 text-dark focus:ring-accent"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-dark truncate">{groupLabel(group)}</span>
                                <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                                  {groupSourceLabel}
                                </span>
                                {group.id === '00000000-0000-0000-0000-000000000001' && (
                                  <span className="text-[10px] bg-accent/30 text-dark px-1.5 py-0.5 rounded font-medium">
                                    default
                                  </span>
                                )}
                              </div>
                              {group.description && (
                                <p className="text-xs text-gray-400 mt-0.5 truncate">{group.description}</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Modalita'</label>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {visibleModeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, mode: opt.value })}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                        form.mode === opt.value ? opt.active : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {currentModeOption && !visibleModeOptions.some((opt) => opt.value === form.mode) && (
                  <p className="text-xs text-gray-400 mt-2">
                    Modalita attuale: <span className="font-semibold text-gray-500">{currentModeOption.label}</span>. È nascosta dalle impostazioni globali, ma resta mantenuta su questa app finché non la cambi.
                  </p>
                )}
              </div>

              {form.mode === 'entra-app' && (
                <div className="p-3 bg-violet-50 rounded-xl">
                  <label className="block text-sm font-medium text-violet-700 mb-1">Application ID Entra</label>
                  <input
                    type="text"
                    value={form.sso_endpoint}
                    onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                    placeholder="094e5413-db00-4adc-a790-7971fef8c104"
                    className="w-full px-3 py-2 border border-violet-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                  <p className="text-xs text-violet-500 mt-1">
                    L&apos;Application ID si trova nell&apos;URL di MyApps: launcher.myapps.microsoft.com/api/signin/&lt;ID&gt;
                  </p>
                </div>
              )}

              {form.mode === 'redirect' && (
                <div className="grid grid-cols-[1fr_auto] gap-4 p-3 bg-blue-50 rounded-xl">
                  <div>
                    <label className="block text-sm font-medium text-blue-700 mb-1">Endpoint SSO</label>
                    <input
                      type="text"
                      value={form.sso_endpoint}
                      onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                      placeholder="/sso"
                      className="w-full px-3 py-2 border border-blue-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-blue-700 mb-1">Metodo</label>
                    <select
                      value={form.sso_method}
                      onChange={(e) => setForm({ ...form, sso_method: e.target.value })}
                      className="px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Etichette</label>
                  <TagInput
                    value={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                    suggestions={allTags}
                    placeholder="Digita e premi Invio..."
                  />
                  <p className="text-xs text-gray-400 mt-1">Invio o virgola per aggiungere. Appaiono come badge sulla card.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Ordine</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Descrizione estesa (HTML)</label>
                <textarea
                  value={form.long_description}
                  onChange={(e) => setForm({ ...form, long_description: e.target.value })}
                  placeholder="<p>Descrizione dettagliata dell'applicazione...</p>"
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                />
                <p className="text-xs text-gray-400 mt-1">Supporta HTML (sanitizzato). Visibile cliccando il bottone info sulla card.</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-100">
              <button
                onClick={close}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-dark hover:bg-gray-100 rounded-xl transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.slug || !form.target_url}
                className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Salvataggio...' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
