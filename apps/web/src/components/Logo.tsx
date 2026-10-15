/** The mark: a hotspot under two satellite signal arcs. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="#161312" />
      <circle cx="14" cy="16.5" r="3.6" fill="#FF5A1F" />
      <path d="M8.6 11.2a7.6 7.6 0 0 1 10.8 0" stroke="#FF5A1F" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
      <path d="M5.6 8a11.8 11.8 0 0 1 16.8 0" stroke="#FF5A1F" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}
