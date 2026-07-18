export default function TrophyWatermark({ className = "" }) {
  return (
    <svg
      className={`trophy-watermark ${className}`.trim()}
      viewBox="0 0 240 280"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="bragright-cup-metal" x1="42" y1="26" x2="192" y2="246" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity=".34" />
          <stop offset=".46" stopColor="currentColor" stopOpacity=".04" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".22" />
        </linearGradient>
      </defs>
      <path className="trophy-watermark-fill" d="M78 24h84l-8 76c-3 30-15 52-34 66-19-14-31-36-34-66l-8-76Z" fill="url(#bragright-cup-metal)" />
      <path className="trophy-watermark-main" d="M78 24h84l-8 76c-3 30-15 52-34 66-19-14-31-36-34-66l-8-76Z" />
      <path className="trophy-watermark-secondary" d="M80 48H34v18c0 42 20 66 58 72M160 48h46v18c0 42-20 66-58 72" />
      <path className="trophy-watermark-main" d="M120 166v47M82 250h76M94 213h52l12 37H82l12-37Z" />
      <path className="trophy-watermark-secondary" d="m120 56 11 22 24 4-18 17 5 24-22-11-22 11 5-24-18-17 24-4 11-22Z" />
      <path className="trophy-watermark-highlight" d="M101 35c-2 50 2 84 19 108M91 224h58" />
      <circle className="trophy-watermark-orbit" cx="120" cy="105" r="72" />
    </svg>
  );
}
