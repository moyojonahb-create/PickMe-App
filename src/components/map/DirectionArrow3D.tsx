import { motion } from 'framer-motion';

interface DirectionArrow3DProps {
  /** Bearing in degrees, 0 = north, clockwise. */
  bearing: number;
  className?: string;
}

/**
 * Floating 3D-style directional arrow that smoothly rotates toward the
 * current bearing. Pure CSS / SVG — no WebGL.
 */
export default function DirectionArrow3D({ bearing, className = '' }: DirectionArrow3DProps) {
  return (
    <div
      className={`pointer-events-none flex items-center justify-center w-16 h-16 rounded-full bg-white/25 backdrop-blur-xl border border-white/40 shadow-[0_12px_30px_rgba(0,0,0,0.22)] ${className}`}
      style={{ perspective: '320px' }}
    >
      <motion.svg
        viewBox="0 0 64 64"
        className="w-12 h-12 drop-shadow-[0_4px_8px_rgba(27,63,160,0.45)]"
        animate={{ rotate: bearing }}
        transition={{ type: 'spring', stiffness: 90, damping: 18 }}
        style={{ transform: 'rotateX(35deg)', transformStyle: 'preserve-3d' }}
      >
        <defs>
          <linearGradient id="arrow3dGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FACC15" />
            <stop offset="55%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#1B3FA0" />
          </linearGradient>
        </defs>
        <path
          d="M32 4 L52 50 L32 40 L12 50 Z"
          fill="url(#arrow3dGrad)"
          stroke="#ffffff"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      </motion.svg>
    </div>
  );
}
