const sizeClasses = {
  sm: 'w-8 h-8 rounded-lg',
  lg: 'w-16 h-16 rounded-2xl',
};

const iconSizes = {
  sm: '18',
  lg: '34',
};

export default function BrandMark({ size = 'sm' }) {
  const outer = sizeClasses[size] || sizeClasses.sm;
  const iconSize = iconSizes[size] || iconSizes.sm;

  return (
    <div
      className={`${outer} relative overflow-hidden shadow-[0_10px_24px_rgba(26,26,26,0.12)]`}
      style={{
        background:
          'linear-gradient(145deg, #1A1A1A 0%, #2A2A2A 58%, #111111 100%)',
      }}
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 m-auto"
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
      >
        <rect
          x="6"
          y="4"
          width="11"
          height="16"
          rx="2.25"
          fill="#F7F4EC"
          opacity="0.96"
        />
        <rect x="8.25" y="6.25" width="5.75" height="11.5" rx="1.25" fill="#1A1A1A" />
        <circle cx="14.25" cy="12" r="0.95" fill="#C5F467" />
        <path
          d="M4.5 18.2C6.1 19.7 8.15 20.5 10.4 20.5H12.1C14.2 20.5 16.1 19.8 17.65 18.55"
          stroke="#C5F467"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.95"
        />
      </svg>
    </div>
  );
}
