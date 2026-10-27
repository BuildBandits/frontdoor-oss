import { BookOpen, Boxes, Code2, ExternalLink, FileJson, PlugZap, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useBrandingLanguage } from '../stores/brandingStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';
import {
  manifestExample,
  packageExample,
  moduleExample,
  PLUGIN_DOC_ENV_HINTS,
} from '../pluginHost/pluginDocsContent';
import DocsHelpLink from '../components/DocsHelpLink';

export default function AdminPluginDocs() {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';
  const brandingLanguage = useBrandingLanguage();

  const ui = getUiStrings(resolveAppLanguage(user?.preferredLanguage, brandingLanguage));
  const t = ui.admin.pluginDocs;
  const plugins = ui.admin.plugins;

  return (
    <div className="pb-24">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <BookOpen className="h-3.5 w-3.5" />
            {t.badge}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold text-dark dark:text-gray-100">{t.pageTitle}</h1>
          <p className="mt-1 max-w-3xl text-gray-500 dark:text-gray-400">{t.subtitle}</p>
          <DocsHelpLink page="integrators/plugins" className="mt-2" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/plugins"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-semibold text-dark dark:text-gray-100 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <PlugZap className="h-4 w-4" />
            {t.backToPlugins}
          </Link>
          {isOwner && (
            <Link
              to="/admin/plugins/audit"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-semibold text-violet-700 dark:text-violet-300 transition-colors hover:bg-violet-50 dark:hover:bg-violet-950/30"
            >
              <ShieldCheck className="h-4 w-4" />
              {plugins.pluginAuditAction}
            </Link>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            <RefreshCw className="h-4 w-4" />
            {ui.common.refresh}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
            <Code2 className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            {plugins.manifestTitle}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{plugins.manifestHelp}</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-gray-950 px-4 py-3 text-[12px] leading-6 text-gray-100">
            {manifestExample()}
          </pre>
        </section>

        <section className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
            <Boxes className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            {plugins.packageLabel}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{plugins.packageHelp}</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-gray-950 px-4 py-3 text-[12px] leading-6 text-gray-100">
            {packageExample()}
          </pre>
        </section>

        <section className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
            <ExternalLink className="h-4 w-4 text-sky-600 dark:text-sky-300" />
            {plugins.moduleTitle}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{plugins.moduleHelp}</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-gray-950 px-4 py-3 text-[12px] leading-6 text-gray-100">
            {moduleExample()}
          </pre>
        </section>

        <section className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
            <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            {plugins.loaderTitle}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{plugins.loaderHelp}</p>
          <ul className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300">
            {PLUGIN_DOC_ENV_HINTS.map((hint) => (
              <li key={hint} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 px-3 py-2 font-mono text-xs">
                {hint}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
            <FileJson className="h-4 w-4 text-amber-600 dark:text-amber-300" />
            {plugins.liveManifestPreview}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t.manifestPreviewHelp}
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-gray-950 px-4 py-3 text-[12px] leading-6 text-gray-100">
            {manifestExample()}
          </pre>
        </section>

        <section className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-dark dark:text-gray-100 font-bold">
            <ShieldCheck className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            {plugins.validationWizard}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{plugins.reviewPackageIntro}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4">
              <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{plugins.riskLevel}</div>
              <div className="mt-1 text-lg font-extrabold text-dark dark:text-gray-100">{t.validationStepOne}</div>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t.validationStepOneHelp}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4">
              <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{plugins.scoreLabel}</div>
              <div className="mt-1 text-lg font-extrabold text-dark dark:text-gray-100">{t.validationStepTwo}</div>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t.validationStepTwoHelp}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40 p-4">
              <div className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{plugins.packageName}</div>
              <div className="mt-1 text-lg font-extrabold text-dark dark:text-gray-100">{t.validationStepThree}</div>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t.validationStepThreeHelp}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
