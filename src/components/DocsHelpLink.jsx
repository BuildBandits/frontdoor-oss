import { CircleHelp } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingLanguage } from '../stores/brandingStore';
import { getUiStrings, resolveAppLanguage } from '../i18n';
import { docsUrl } from '../utils/docsLinks';

/** "Help" link to the matching web docs page, in the user's language. */
export default function DocsHelpLink({ page, className = '' }) {
  const user = useAuthStore((state) => state.user);
  const brandingLanguage = useBrandingLanguage();
  const language = resolveAppLanguage(user?.preferredLanguage, brandingLanguage);
  const href = docsUrl(page, language);
  if (!href) return null;
  const ui = getUiStrings(language);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-dark dark:hover:text-white hover:underline underline-offset-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      <CircleHelp className="h-4 w-4 shrink-0" aria-hidden="true" />
      {ui.common.docsHelp}
      <span className="sr-only"> ({ui.common.opensInNewTab})</span>
    </a>
  );
}
