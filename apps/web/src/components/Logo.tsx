/** Le carnet au signet moutarde. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true">
      <rect x="5" y="3" width="17" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9 3v22" stroke="currentColor" strokeWidth="2" />
      <path d="M18.5 3v22" stroke="#F2B33D" strokeWidth="2.4" />
    </svg>
  );
}
