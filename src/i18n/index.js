import zh from './zh.json' with { type: 'json' }

const dict = zh

export function t(key, vars) {
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict)
  if (typeof v !== 'string') return key
  if (!vars) return v
  return v.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m))
}
