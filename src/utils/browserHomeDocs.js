const HOMEPAGE_DOCS = [
  {
    browser: 'firefox',
    label: 'Firefox',
    urls: {
      it: 'https://support.mozilla.org/it/kb/Impostare%20la%20pagina%20iniziale',
      en: 'https://support.mozilla.org/en-US/kb/how-to-set-the-home-page',
    },
  },
  {
    browser: 'chrome',
    label: 'Chrome',
    urls: {
      it: 'https://support.google.com/chrome/answer/95314?co=GENIE.Platform%3DDesktop&hl=it-IT',
      en: 'https://support.google.com/chrome/answer/95314?co=GENIE.Platform%3DDesktop&hl=en',
    },
  },
  {
    browser: 'edge',
    label: 'Edge',
    urls: {
      it: 'https://support.microsoft.com/it-it/microsoft-edge/cambiare-la-pagina-iniziale-del-browser-a531e1b8-ed54-d057-0262-cc5983a065c6',
      en: 'https://support.microsoft.com/en-au/microsoft-edge/change-your-browser-home-page-a531e1b8-ed54-d057-0262-cc5983a065c6',
    },
  },
  {
    browser: 'safari',
    label: 'Safari',
    urls: {
      it: 'https://support.apple.com/guide/safari/ibrw1020/mac',
      en: 'https://support.apple.com/guide/safari/ibrw1020/mac',
    },
  },
];

export function detectBrowser(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'chrome';
  if (ua.includes('safari/') && !ua.includes('chrome/') && !ua.includes('crios/') && !ua.includes('edg/')) {
    return 'safari';
  }
  return 'unknown';
}

export function getBrowserHomepageDocs(userAgent = '', locale = 'it') {
  const lang = String(locale).toLowerCase().startsWith('it') ? 'it' : 'en';
  const detectedBrowser = detectBrowser(userAgent);
  const order = HOMEPAGE_DOCS.slice().sort((a, b) => {
    if (a.browser === detectedBrowser) return -1;
    if (b.browser === detectedBrowser) return 1;
    return 0;
  });

  return order.map((doc) => ({
    browser: doc.browser,
    label: doc.label,
    url: doc.urls[lang] || doc.urls.en,
    detected: doc.browser === detectedBrowser,
  }));
}
