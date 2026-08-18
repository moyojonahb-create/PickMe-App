import { MapPin, Navigation2 } from 'lucide-react';
import { motion } from 'framer-motion';
import pickMeCarIcon from '@/assets/pickme-car-icon.png';

const PhoneMockup = () => {
  return (
    <div className="relative mx-auto w-[260px] sm:w-[300px]">
      {/* Glow */}
      <div className="absolute -inset-4 bg-gradient-to-b from-accent/20 to-primary-foreground/5 blur-2xl rounded-[4rem] -z-10" />

      {/* Phone Frame */}
      <div className="relative bg-foreground rounded-[2.8rem] p-[10px] shadow-[0_30px_80px_-20px_hsl(0_0%_0%/0.5)]">
        {/* Screen */}
        <div className="relative bg-background rounded-[2.3rem] overflow-hidden">
          {/* Notch */}
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[90px] h-[26px] bg-foreground rounded-full z-20" />

          {/* Status bar */}
          <div className="bg-background px-7 py-3 flex items-center justify-between pt-5">
            <span className="text-[11px] font-bold text-foreground">9:41</span>
            <div className="flex items-center gap-1">
              <div className="flex gap-[2px]">
                {[1.5, 2, 2.5, 3].map((h, i) => (
                  <div key={i} className="w-[3px] rounded-sm bg-foreground" style={{ height: `${h * 4}px` }} />
                ))}
              </div>
              <div className="w-6 h-[10px] border border-foreground rounded-[3px] ml-1 relative">
                <div className="absolute inset-[1.5px] bg-foreground rounded-[1px]" style={{ width: '60%' }} />
              </div>
            </div>
          </div>

          {/* Map Area */}
          <div className="relative h-[280px] sm:h-[320px] bg-gradient-to-br from-muted/50 via-background to-secondary/50">
            {/* Stylized map grid */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="mapgrid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-foreground" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#mapgrid)" />
            </svg>

            {/* Faux roads */}
            <div className="absolute top-[40%] left-0 right-0 h-[2px] bg-border/40 rotate-[-8deg]" />
            <div className="absolute top-[55%] left-0 right-0 h-[2px] bg-border/30 rotate-[5deg]" />
            <div className="absolute top-0 bottom-0 left-[35%] w-[2px] bg-border/30 rotate-[12deg]" />

            {/* Route line */}
            <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="routeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="hsl(var(--accent))" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" />
                </linearGradient>
              </defs>
              <motion.path
                d="M 70 240 Q 100 190, 140 165 T 200 100 T 230 70"
                fill="none"
                stroke="url(#routeGrad)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="6 4"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.5, delay: 0.5 }}
              />
            </svg>

            {/* Pickup Pin */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.8, type: 'spring', stiffness: 200 }}
              className="absolute left-[50px] bottom-[55px]"
            >
              <div className="relative">
                <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center shadow-lg ring-[3px] ring-accent/25">
                  <MapPin className="w-4 h-4 text-accent-foreground" />
                </div>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-accent rotate-45 -z-10" />
              </div>
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-bold text-foreground whitespace-nowrap bg-card px-2 py-0.5 rounded-full shadow-sm border border-border/50">
                Pickup
              </span>
            </motion.div>

            {/* Destination Pin */}
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 1, type: 'spring', stiffness: 200 }}
              className="absolute right-[30px] top-[35px]"
            >
              <div className="relative">
                <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg ring-[3px] ring-primary/25">
                  <Navigation2 className="w-4 h-4 text-primary-foreground" />
                </div>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-primary rotate-45 -z-10" />
              </div>
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-bold text-foreground whitespace-nowrap bg-card px-2 py-0.5 rounded-full shadow-sm border border-border/50">
                Drop-off
              </span>
            </motion.div>

            {/* Moving car */}
            <motion.div
              initial={{ x: -20, y: 20 }}
              animate={{ x: 0, y: 0 }}
              transition={{ delay: 1.2, duration: 1, type: 'spring' }}
              className="absolute left-[120px] top-[140px]"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" style={{ animationDuration: '2s' }} />
                <img src={pickMeCarIcon} alt="" className="w-14 h-auto object-contain drop-shadow-md" />
              </div>
            </motion.div>
          </div>

          {/* Bottom Card */}
          <div className="bg-card p-4 rounded-t-2xl -mt-4 relative z-10 shadow-[0_-4px_20px_hsl(0_0%_0%/0.06)]">
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2.5 p-2.5 bg-secondary/70 rounded-xl">
                <div className="w-2.5 h-2.5 rounded-full bg-accent shadow-sm ring-2 ring-accent/20" />
                <span className="text-xs text-foreground font-medium">CBD, Gwanda</span>
              </div>
              <div className="flex items-center gap-2.5 p-2.5 bg-secondary/70 rounded-xl">
                <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-sm ring-2 ring-primary/20" />
                <span className="text-xs text-foreground font-medium">Jahunda, Gwanda</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-foreground">$2.00</p>
                <p className="text-[10px] text-muted-foreground">1.8 km • 4 min</p>
              </div>
              <div className="px-5 py-2.5 bg-primary text-primary-foreground font-bold rounded-full text-xs shadow-sm">
                Request
              </div>
            </div>
          </div>
        </div>

        {/* Home indicator */}
        <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 w-28 h-1 bg-muted-foreground/30 rounded-full" />
      </div>
    </div>
  );
};

export default PhoneMockup;
