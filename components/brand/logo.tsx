/**
 * Brand mark. Uses the uploaded logo from Settings when present and
 * falls back to a drawn balloon mark, so the app is never unbranded
 * (Spec 2.1).
 */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="Royze Party Needs Rental"
    >
      <rect width="40" height="40" rx="10" fill="var(--color-brand-600)" />
      {/* balloon */}
      <ellipse cx="20" cy="17" rx="8" ry="9.5" fill="white" />
      <path
        d="M20 26.5c-1.2 1.4.9 2.2-.4 3.6"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="17" cy="14" rx="2.2" ry="3" fill="var(--color-brand-100)" />
      {/* confetti */}
      <circle cx="31" cy="9" r="1.6" fill="var(--color-accent-400)" />
      <circle cx="8" cy="28" r="1.4" fill="var(--color-accent-400)" />
      <circle cx="32" cy="30" r="1.2" fill="var(--color-brand-200)" />
    </svg>
  );
}

export function BrandLock({
  businessName = "Royze Party Needs Rental",
  logoUrl,
  className = "",
  compact = false,
}: {
  businessName?: string;
  logoUrl?: string | null;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {logoUrl ? (
        // User-uploaded logo from Supabase Storage, rendered at a fixed
        // tiny size — next/image adds no value here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="size-9 rounded-lg object-contain"
        />
      ) : (
        <LogoMark />
      )}
      {!compact && (
        <span className="text-[15px] font-bold leading-tight text-ink-900">
          {businessName}
        </span>
      )}
    </div>
  );
}
