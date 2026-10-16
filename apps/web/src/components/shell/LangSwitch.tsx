import { dict, useLang, useT, type Lang } from '../../i18n';

const text = dict({ id: { language: 'Bahasa', id: 'Bahasa Indonesia', en: 'English' }, en: { language: 'Language', id: 'Bahasa Indonesia', en: 'English' } });

/** ID | EN, remembered on this device. */
export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLang();
  const t = useT(text);
  return (
    <div className={`langswitch ${className}`} role="group" aria-label={t('language')}>
      {(['id', 'en'] as Lang[]).map(code => (
        <button key={code} type="button" lang={code} aria-pressed={lang === code} aria-label={t(code)} className={lang === code ? 'on' : ''} onClick={() => setLang(code)}>{code.toUpperCase()}</button>
      ))}
    </div>
  );
}
