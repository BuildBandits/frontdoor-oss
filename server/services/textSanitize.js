import path from 'path';

// Removes HTML tags in linear time and never leaves a '<' behind, so nested
// input such as `<<b>script>` cannot rebuild a tag after a single pass.
export function stripTags(value) {
  const text = (value ?? '').toString();
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    const close = text.indexOf('>', open + 1);
    if (close === -1) {
      // No tag can close after this point: keep the text, drop the stray '<'.
      out += text.slice(open + 1).replaceAll('<', '');
      break;
    }
    i = close + 1;
  }
  return out;
}

// Trims leading and trailing dashes without a backtracking regex.
export function trimDashes(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
}

// Joins a stored file name to its directory, or returns null when the name is
// not a plain file name (path separators, '..') and would leave the directory.
export function resolveFileInDir(dir, fileName) {
  const name = (fileName ?? '').toString();
  if (!name || name === '.' || name === '..' || path.basename(name) !== name || name.includes('\\')) return null;
  const root = path.resolve(dir);
  const absolutePath = path.resolve(root, name);
  return path.dirname(absolutePath) === root ? absolutePath : null;
}
