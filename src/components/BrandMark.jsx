export default function BrandMark({ size = 'sm' }) {
  const outer = size === 'lg' ? 'w-16 h-16 rounded-2xl' : 'w-8 h-8 rounded-lg';

  return (
    <div
      className={`${outer} relative overflow-hidden bg-transparent`}
      aria-hidden="true"
    >
      <img
        src="/frontdoor-icon.svg"
        alt=""
        className="absolute inset-0 h-full w-full object-contain"
        draggable="false"
      />
    </div>
  );
}
