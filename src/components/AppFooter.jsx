import { APP_NAME, APP_SIGNATURE, APP_VERSION } from '../config/appInfo';
import { getUiStrings, normalizeLanguage } from '../i18n';

export default function AppFooter({ language = 'en' }) {
  const ui = getUiStrings(normalizeLanguage(language));
  return (
    <footer className="border-t border-gray-100 bg-white/80 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-dark">
              {APP_NAME} <span className="text-gray-400">{APP_VERSION}</span> (<span className="font-mono text-gray-400">{APP_SIGNATURE}</span>)
            </p>
            <p className="mt-1 text-sm text-gray-400 md:italic">{ui.footer.claim}</p>
          </div>

          <div className="text-xs text-gray-500 md:text-right">
            <p>
              {ui.footer.openSourceNote} · {ui.footer.licensedUnder}{' '}
              <a
                href="https://opensource.org/license/mit"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-gray-700 hover:text-dark hover:underline"
              >
                {ui.footer.licenseLabel}
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
