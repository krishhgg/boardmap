// KiCad's text format is a tree of atoms and lists. Keep atoms as strings.
export function parse(text) {
  const root = [], stack = [root];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ';') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '(') { const node = []; stack.at(-1).push(node); stack.push(node); i++; }
    else if (c === ')') {
      if (stack.length === 1) throw new Error('Unexpected closing parenthesis');
      stack.pop(); i++;
    } else if (c === '"') {
      let value = ''; i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          i++;
          if (i === text.length) throw new Error('Unterminated escape');
          const escaped = text[i++];
          value += ({n:'\n', r:'\r', t:'\t'})[escaped] ?? escaped;
        } else value += text[i++];
      }
      if (text[i] !== '"') throw new Error('Unterminated string');
      i++; stack.at(-1).push(value);
    } else {
      const start = i;
      while (i < text.length && !/[\s()]/.test(text[i])) i++;
      stack.at(-1).push(text.slice(start, i));
    }
  }
  if (stack.length !== 1 || root.length !== 1 || !Array.isArray(root[0])) throw new Error('Invalid s-expression');
  return root[0];
}
export const children = (node, key) => node.filter(v => Array.isArray(v) && v[0] === key);
export const child = (node, key) => children(node, key)[0];
export const atom = (node, key, fallback = '') => child(node, key)?.[1] ?? fallback;
