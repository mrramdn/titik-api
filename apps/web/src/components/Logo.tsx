/** "Pin Nyala": a map pin whose head turns into a flame, with a hole marking the point. */
export const logoPath = 'M12 23C12 23 4.6 15.6 4.6 10.6C4.6 7.9 5.9 5.6 8 4.3C8.1 5.9 8.9 7 10 7.5C9.6 5 10.6 2.6 13.4 0.8C13.2 3 14.4 4.4 16.2 5.4C18.1 6.5 19.4 8.4 19.4 10.6C19.4 15.6 12 23 12 23ZM12 8.3a2.4 2.4 0 1 0 0.001 0Z';

export function LogoMark({ size = 24, color = '#FF5A1F', title }: { size?: number; color?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path fill={color} fillRule="evenodd" d={logoPath} />
    </svg>
  );
}
