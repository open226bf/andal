/** Deux volumes penchés l'un contre l'autre forment le A d'Andal; le signet moutarde en fait la barre. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="9.5" y="17.9" width="13" height="3.2" fill="#F2B33D" />
      <path d="M9.89 5.36Q10.36 4.04 11.68 4.52L14.69 5.62Q16 6.09 15.52 7.41L8.03 28H1.65ZM22.11 5.36Q21.64 4.04 20.32 4.52L17.31 5.62Q16 6.09 16.48 7.41L23.97 28H30.35Z" fill="currentColor" />
    </svg>
  );
}
