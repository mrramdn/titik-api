// Two languages, Indonesian first. Each page keeps its own dictionary next to it, so screens can change
// without touching a shared file; both languages must have exactly the same keys (checked by the types).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'id' | 'en';
export type Vars = Record<string, string | number>;
/** A dictionary whose Indonesian and English halves share every key. */
export interface Dict<K extends string> { id: Record<K, string>; en: Record<K, string> }
export const dict = <K extends string>(value: Dict<K>) => value;

const storageKey = 'titikapi.lang';
const LangContext = createContext<{ lang: Lang; setLang(lang: Lang): void }>({ lang: 'id', setLang() {} });

// Indonesian unless the visitor chose English: browsers in test rigs often report en-US.
function stored(): Lang {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'id'; } catch { return 'id'; }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(stored);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(storageKey, next); } catch { /* private mode */ }
  }, []);
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** Replaces {name} placeholders. */
export const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text);

/** Returns t(key, vars) for the current language. */
export function useT<K extends string>(dictionary: Dict<K>) {
  const { lang } = useLang();
  return useCallback((key: K, vars?: Vars) => fill(dictionary[lang][key] ?? dictionary.id[key], vars), [dictionary, lang]);
}
