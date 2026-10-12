// Excel-style "All" handling for multi selects whose empty value means "no filter".
// An empty selection shows every item checked; unchecking everything also means
// "no filter" and is tracked by `noneChecked` so the checkboxes can show it.

export function isAllChecked(values, noneChecked) {
  return values.length === 0 && !noneChecked;
}

export function isItemChecked(itemValue, values, noneChecked) {
  return isAllChecked(values, noneChecked) || values.includes(itemValue);
}

export function toggleAll(values, noneChecked) {
  return { values: [], noneChecked: isAllChecked(values, noneChecked) };
}

export function toggleItem(itemValues, values, noneChecked, itemValue) {
  const checked = isAllChecked(values, noneChecked) ? itemValues : values;
  const next = checked.includes(itemValue)
    ? checked.filter((value) => value !== itemValue)
    : [...checked, itemValue];
  if (next.length === 0) return { values: [], noneChecked: true };
  if (itemValues.every((value) => next.includes(value))) return { values: [], noneChecked: false };
  return { values: next, noneChecked: false };
}
