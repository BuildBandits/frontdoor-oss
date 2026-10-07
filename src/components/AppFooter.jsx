import { APP_NAME, APP_VERSION, APP_WEBSITE_URL } from '../config/appInfo';
import { getUiStrings, normalizeLanguage } from '../i18n';

const linkClassName = 'font-semibold text-gray-700 dark:text-gray-100 hover:text-dark dark:hover:text-white hover:underline underline-offset-2';

export default function AppFooter({ language = 'en' }) {
  const ui = getUiStrings(normalizeLanguage(language));
  return (
    <footer className="border-t border-gray-100 dark:border-gray-800 bg-white/80 backdrop-blur-sm dark:bg-gray-900 dark:backdrop-blur-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <p className="text-xs text-gray-500 dark:text-gray-300 md:text-right">
          <span className="text-sm">
            <a href={APP_WEBSITE_URL} target="_blank" rel="noreferrer" className={linkClassName}>
              {APP_NAME}
            </a>{' '}
            {APP_VERSION}
          </span>
          {' · '}{ui.footer.licensedUnder}{' '}
          <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer" className={linkClassName}>
            {ui.footer.licenseLabel}
          </a>
        </p>
      </div>
    </footer>
  );
}
