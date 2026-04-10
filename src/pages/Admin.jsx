import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Save } from 'lucide-react';
import api from '../services/api';
import TagInput from '../components/TagInput';

const emptyApp = { name: '', slug: '', description: '', long_description: '', icon: '📦', target_url: '', sort_order: 0, mode: 'redirect-plain', sso_endpoint: '/sso', sso_method: 'GET', tags: [] };

export default function Admin() {
  const [apps, setApps] = useState([]);
  const [editing, setEditing] = useState(null); // null = closed, 'new' = creating, or app object
  const [form, setForm] = useState(emptyApp);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadApps = () => {
    api.get('/apps/all').then((res) => {
      setApps(res.data.apps);
      setLoading(false);
    });
  };

  useEffect(() => { loadApps(); }, []);

  const openNew = () => {
    setForm(emptyApp);
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
    setEditing(app);
  };

  const close = () => {
    setEditing(null);
    setForm(emptyApp);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.post('/apps', form);
      } else {
        await api.put(`/apps/${editing.id}`, form);
      }
      loadApps();
      close();
    } catch (err) {
      alert(err.response?.data?.error || 'Errore nel salvataggio');
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
          Nuova App
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
                      <span className="text-2xl">{app.icon}</span>
                      <span className="font-semibold text-dark">{app.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{app.slug}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-[200px]">{app.target_url}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      app.mode === 'redirect' ? 'bg-blue-100 text-blue-700'
                        : app.mode === 'shared-cookie' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {app.mode === 'redirect' ? 'SSO' : app.mode === 'shared-cookie' ? 'cookie' : 'link'}
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
        </div>
      )}

      {/* Modal */}
      {editing !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-dark">
                {editing === 'new' ? 'Nuova App' : 'Modifica App'}
              </h2>
              <button onClick={close} className="p-2 text-gray-400 hover:text-dark rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-[auto_1fr] gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Icona</label>
                  <input
                    type="text"
                    value={form.icon}
                    onChange={(e) => setForm({ ...form, icon: e.target.value })}
                    className="w-16 h-11 text-center text-2xl border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                  />
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

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Modalita'</label>
                <div className="flex gap-2">
                  {[
                    { value: 'redirect-plain', label: 'Link esterno', active: 'bg-dark text-white border-dark' },
                    { value: 'shared-cookie', label: 'Shared Cookie', active: 'bg-emerald-600 text-white border-emerald-600' },
                    { value: 'redirect', label: 'Redirect SSO', active: 'bg-blue-600 text-white border-blue-600' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, mode: opt.value })}
                      className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                        form.mode === opt.value ? opt.active : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

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

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Etichette</label>
                <TagInput
                  value={form.tags}
                  onChange={(tags) => setForm({ ...form, tags })}
                  placeholder="Digita e premi Invio..."
                />
                <p className="text-xs text-gray-400 mt-1">Invio o virgola per aggiungere. Appaiono come badge sulla card.</p>
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

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Ordine</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                  className="w-24 px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                />
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
