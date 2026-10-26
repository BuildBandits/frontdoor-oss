// Menu options in alphabetical order for the current language. The "all" entry
// (value 'all' or a clearSelection option) stays first as the default.
const isPinned = (option) => option.value === 'all' || option.clearSelection === true;

export function sortOptionsByLabel(options, language) {
  const collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
  const pinned = options.filter(isPinned);
  const rest = options.filter((option) => !isPinned(option));
  return [...pinned, ...rest.sort((a, b) => collator.compare(String(a.label), String(b.label)))];
}
