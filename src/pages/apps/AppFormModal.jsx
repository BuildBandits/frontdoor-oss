import { X, Save, Copy, Users } from 'lucide-react';
import TagInput from '../../components/TagInput';
import AppIcon from '../../components/AppIcon';
import Modal from '../../components/Modal';
import DocsHelpLink from '../../components/DocsHelpLink';
import { normalizeEntraApplicationId } from '../../../shared/entra.js';

export default function AppFormModal({
  editing,
  close,
  apps,
  ui,
  a,
  setIconMode,
  setIconAssetDataUrl,
  setIconAssetPreview,
  setIconSvgText,
  setRemoveIconAsset,
  iconMode,
  form,
  setForm,
  handleIconPaste,
  applyIconAssetFile,
  iconFileInputRef,
  iconAssetPreview,
  handleIconFileChange,
  iconSvgText,
  slugAutoFillRef,
  includeDefaultGroup,
  setIncludeDefaultGroup,
  visibleModeOptions,
  handleModeChange,
  currentModeOption,
  allTags,
  t,
  handleSaveAndAssignGroups,
  saving,
  openClone,
  cloning,
  canEdit,
  handleSave,
}) {
  return (
    <>
      {editing !== null && (
        <Modal onClose={close} closeOnEscape={false} closeOnBackdrop={false} labelledBy="apps-dialog-1-title" panelClassName="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-6xl shadow-xl my-auto" overlayClassName="fixed inset-0 bg-black/40 flex items-start justify-center z-50 px-4 py-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 id="apps-dialog-1-title" className="text-xl font-bold text-dark dark:text-gray-100">
                {editing === 'new' ? ui.admin.apps.newApp : ui.admin.apps.editApp}
              </h2>
              <DocsHelpLink page="admins/apps" className="ml-auto mr-2" />
              <button type="button" onClick={close} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/50 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.icon}</label>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {a.iconHelp}
                    </p>
                  </div>
                  <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
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
                        iconMode === 'emoji' ? 'bg-dark text-white' : 'text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white'
                      }`}
                    >
                      {a.useEmoji}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIconMode('asset')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        iconMode === 'asset' ? 'bg-dark text-white' : 'text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white'
                      }`}
                    >
                      {a.useImage}
                    </button>
                  </div>
                </div>

                {iconMode === 'emoji' ? (
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr] items-center">
                    <div className="w-16 h-16 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center justify-center">
                      <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.emojiOrSymbol}</label>
                      <input
                        type="text"
                        value={form.icon}
                        onChange={(e) => setForm({ ...form, icon: e.target.value })}
                        placeholder="📦"
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
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
                      className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4 text-center cursor-pointer hover:border-accent transition-colors outline-hidden min-h-[180px] flex flex-col items-center justify-center gap-3"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                        {iconAssetPreview ? (
                          <img src={iconAssetPreview} alt={a.uploadedIconPreview} className="w-full h-full object-contain" />
                        ) : (
                          <AppIcon app={{ icon: form.icon }} className="w-10 h-10" textClassName="text-3xl" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-dark dark:text-gray-100">{a.iconUploadCta}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{a.iconUploadHint}</p>
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
                        <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.pasteSvgLabel}</label>
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
                          placeholder={a.svgPlaceholder}
                          rows={4}
                          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-xs focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500 resize-y"
                        />
                      </div>

                      {iconAssetPreview && (
                        <div className="flex items-center justify-between gap-3 text-xs text-gray-400 dark:text-gray-500">
                          <span>{a.uploadedIconPreview}</span>
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
                            {a.removeImage}
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {a.iconPasteHint}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.nameLabel}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={a.nameExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.slugLabel}</label>
                <input
                  type="text"
                  value={form.slug}
                  maxLength={63}
                  onChange={(e) => {
                    slugAutoFillRef.current = true;
                    setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
                  }}
                  placeholder={a.slugExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
                <p className="mt-1 flex items-center justify-between gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <span>{a.slugHelp}</span>
                  <span className="shrink-0 font-mono">
                    {form.slug.length}/63
                  </span>
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {a.slugLimitHelp}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.descriptionLabel}</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={a.descriptionPlaceholder}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.targetUrlLabel}</label>
                <input
                  type="url"
                  value={form.target_url}
                  onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                  placeholder={a.targetUrlExample}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                />
                {form.mode === 'internal-link' && (
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    {a.internalLinkHelp}
                  </p>
                )}
              </div>

                {editing === 'new' && (
                  <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/50 p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeDefaultGroup}
                        onChange={(e) => setIncludeDefaultGroup(e.target.checked)}
                        className="mt-1 rounded-sm border-gray-300 dark:border-gray-600 text-dark dark:text-gray-100 focus:ring-accent"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-dark dark:text-gray-100">{a.addToDefaultGroup}</span>
                          <span className="text-[10px] bg-accent/20 text-dark dark:text-gray-100 px-1.5 py-0.5 rounded-sm font-medium">
                            {ui.common.defaultRecommended}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {a.defaultGroupIncludedHelp}
                        </p>
                      </div>
                    </label>
                  </div>
                )}

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.connection}</label>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {visibleModeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleModeChange(opt.value)}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                        form.mode === opt.value ? opt.active : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {currentModeOption && !visibleModeOptions.some((opt) => opt.value === form.mode) && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    {a.currentMode}: <span className="font-semibold text-gray-500 dark:text-gray-400">{currentModeOption.label}</span>. {a.currentModeHelp}
                  </p>
                )}
              </div>

              {form.mode === 'entra-app' && (
                <div className="p-3 bg-violet-50 dark:bg-violet-950/40 rounded-xl border border-violet-100 dark:border-violet-900/50">
                    <label className="block text-sm font-medium text-violet-700 dark:text-violet-300 mb-1">{ui.admin.apps.entraApplicationId}</label>
                  <input
                    type="text"
                    value={form.sso_endpoint}
                    onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                    onBlur={(e) => {
                      const normalized = normalizeEntraApplicationId(e.target.value);
                      if (normalized !== e.target.value) {
                        setForm((prev) => ({ ...prev, sso_endpoint: normalized }));
                      }
                    }}
                    placeholder={ui.admin.apps.enterApplicationId}
                    className="w-full px-3 py-2 border border-violet-200 dark:border-violet-800 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-violet-400 dark:focus-visible:ring-violet-600"
                  />
                  <p className="text-xs text-violet-500 dark:text-violet-400 mt-1">
                    {ui.admin.apps.applicationIdHelp}
                  </p>
                </div>
              )}

              {form.mode === 'redirect' && (
                <div className="grid grid-cols-[1fr_auto] gap-4 p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/50">
                    <div>
                    <label className="block text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">{a.ssoEndpointLabel}</label>
                    <input
                      type="text"
                      value={form.sso_endpoint}
                      onChange={(e) => setForm({ ...form, sso_endpoint: e.target.value })}
                      placeholder="/sso"
                      className="w-full px-3 py-2 border border-blue-200 dark:border-blue-800 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-600"
                    />
                    </div>
                    <div>
                    <label className="block text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">{a.ssoMethodLabel}</label>
                    <select
                      value={form.sso_method}
                      onChange={(e) => setForm({ ...form, sso_method: e.target.value })}
                      className="w-full px-3 py-2 border border-blue-200 dark:border-blue-800 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-600"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                    {form.sso_method === 'GET' && (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-md p-2 leading-relaxed">
                        ⚠️ {a.ssoMethodGetWarning}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.tagsLabel}</label>
                  <TagInput
                    value={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                    suggestions={allTags}
                    placeholder={a.tagsPlaceholder}
                    suggestionsLabel={a.tagSuggestionsTitle}
                    availableTagsLabel={a.availableTagsTitle}
                    useSuggestionLabel={a.useExistingTag}
                  />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{ui.admin.apps.enterToAddTags}</p>
                </div>

                <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.sortOrderLabel}</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">{a.longDescriptionLabel}</label>
                <textarea
                  value={form.long_description}
                  onChange={(e) => setForm({ ...form, long_description: e.target.value })}
                  placeholder={a.longDescriptionPlaceholder}
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-mono text-xs focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500 resize-y"
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{a.longDescriptionHelp}</p>
              </div>
            </div>

              <div className="flex flex-col gap-3 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-end">
                {editing !== 'new' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2">
                    <button
                      type="button"
                      onClick={handleSaveAndAssignGroups}
                      disabled={saving || !form.name || !form.slug || !form.target_url}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-dark dark:text-white bg-accent hover:bg-accent/80 dark:bg-accent-dark dark:hover:bg-accent-dark/90 shadow-xs shadow-accent/20 dark:shadow-black/30 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Users className="w-4 h-4" />
                      {saving ? a.saving : a.saveAndAssignGroups}
                    </button>
                    <button
                      type="button"
                      onClick={openClone}
                      disabled={cloning || !canEdit}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-violet-700 hover:text-violet-800 hover:bg-violet-50 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Copy className="w-4 h-4" />
                      {cloning ? a.duplicating : a.duplicate}
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={close}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-dark dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
                  >
                    {ui.common.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !form.name || !form.slug || !form.target_url}
                    className="flex items-center gap-2 px-5 py-2.5 bg-dark text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? a.saving : a.save}
                  </button>
                </div>
            </div>
        </Modal>
      )}
    </>
  );
}
