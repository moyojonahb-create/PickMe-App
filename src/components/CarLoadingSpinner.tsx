import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import pickMeCarIcon from '@/assets/pickme-car-icon.png';

interface Props {
  message?: string;
  onClose?: () => void;
}

export default function CarLoadingSpinner({ message = 'Processing...', onClose }: Props) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center"
    >
      {onClose && (
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground text-sm px-3 py-1.5 rounded-full glass-card">
          Cancel
        </button>
      )}

      <div className="relative w-48 h-48">
        {/* Outer ring */}
        <motion.div
          className="absolute inset-0 rounded-full border-[3px] border-primary/10"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        />

        {/* Spinning arc */}
        <motion.svg
          viewBox="0 0 200 200"
          className="absolute inset-0 w-full h-full"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        >
          <defs>
            <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0" />
              <stop offset="50%" stopColor="hsl(var(--accent))" stopOpacity="1" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r="80" fill="none" stroke="url(#arcGrad)" strokeWidth="4" strokeLinecap="round" strokeDasharray="150 350" />
        </motion.svg>

        {/* Car icon in center */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ y: [0, -4, 0] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
        >
          <img src={pickMeCarIcon} alt="" className="w-32 h-auto object-contain drop-shadow-lg" />
        </motion.div>

        {/* Pulse rings */}
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="absolute inset-0 rounded-full border border-primary/20"
            initial={{ scale: 0.5, opacity: 0.6 }}
            animate={{ scale: 1.3, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 2, delay: i * 0.6, ease: 'easeOut' }}
          />
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-center text-foreground mt-8 max-w-xs text-lg font-medium"
      >
        {message}{dots}
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-center text-muted-foreground mt-2 text-sm"
      >
        This usually takes a few seconds
      </motion.p>
    </motion.div>
  );
}
