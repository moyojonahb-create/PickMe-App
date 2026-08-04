import { ArrowRight, Star, MapPin, Zap, Shield, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import PhoneMockup from '@/components/PhoneMockup';
import { motion } from 'framer-motion';
import heroImage from '@/assets/hero-city.webp';

interface LandingHeroProps {
  onGetStarted?: () => void;
}

const LandingHero = ({ onGetStarted }: LandingHeroProps) => {
  const navigate = useNavigate();

  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden">
      {/* Background image with overlay */}
      <div className="absolute inset-0">
        <img
          src={heroImage}
          alt="City streets at golden hour"
          className="w-full h-full object-cover"
          fetchPriority="high"
          decoding="async"
          width={1920}
          height={1080}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/90 via-primary/80 to-primary/95" />
        {/* Animated grain overlay */}
        <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay" style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
        }} />
      </div>

      {/* Floating decorative elements */}
      <div className="absolute top-20 left-[10%] w-72 h-72 bg-accent/10 rounded-full blur-[100px] animate-pulse-subtle" />
      <div className="absolute bottom-20 right-[10%] w-96 h-96 bg-primary-foreground/5 rounded-full blur-[120px]" />

      {/* Content */}
      <div className="relative flex-1 flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-16 px-6 pt-16 pb-12 sm:pt-20 lg:pt-24 lg:pb-20 pickme-container">
        {/* Left: Text Content */}
        <div className="flex-1 text-center lg:text-left max-w-xl lg:max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 bg-primary-foreground/10 backdrop-blur-sm border border-primary-foreground/10 px-4 py-2 rounded-full mb-6"
          >
            <Zap className="w-4 h-4 text-accent fill-accent" />
            <span className="text-primary-foreground/90 text-sm font-semibold">Zimbabwe's ride-hailing app</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold text-primary-foreground mb-5 tracking-tighter leading-[0.95]"
          >
            Your ride,
            <br />
            <span className="relative inline-block">
              your way.
              <motion.span
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: 0.7 }}
                className="absolute -bottom-1.5 left-0 w-full h-2 bg-accent rounded-full origin-left"
              />
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-primary-foreground/75 text-lg sm:text-xl leading-relaxed mb-8 max-w-md mx-auto lg:mx-0"
          >
            Safe, reliable rides at your fingertips. Book in seconds, ride in minutes across Zimbabwe.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto justify-center lg:justify-start mb-10"
          >
            <Button
              onClick={() => navigate('/ride')}
              variant="accent"
              size="lg"
              className="bg-accent shadow-[var(--shadow-glow)] h-14 px-8 text-base font-bold active:scale-[0.97] transition-all group"
            >
              Request a Ride
              <ArrowRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              onClick={onGetStarted}
              variant="outline"
              size="lg"
              className="bg-primary-foreground/5 backdrop-blur-sm border-2 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/15 h-14 px-8 text-base font-bold active:scale-[0.97] transition-all"
            >
              Sign Up Free
            </Button>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="flex flex-wrap items-center justify-center lg:justify-start gap-5 text-primary-foreground/60"
          >
            <div className="flex items-center gap-2 text-sm">
              <Shield className="w-4 h-4 text-accent" />
              <span>Verified drivers</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-accent" />
              <span>24/7 support</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Star className="w-4 h-4 text-accent fill-accent" />
              <span>4.9 rating</span>
            </div>
          </motion.div>
        </div>

        {/* Right: Phone Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3, type: 'spring', stiffness: 100 }}
          className="flex-shrink-0 relative"
        >
          <div className="absolute -inset-12 bg-accent/10 blur-[80px] rounded-full -z-10" />
          <PhoneMockup />
        </motion.div>
      </div>

      {/* Bottom wave transition */}
      <div className="relative z-10">
        <svg className="w-full h-16 sm:h-24" viewBox="0 0 1440 96" preserveAspectRatio="none" fill="none">
          <path d="M0 96V40C240 80 480 96 720 80C960 64 1200 16 1440 0V96H0Z" fill="hsl(var(--background))" />
        </svg>
      </div>
    </section>
  );
};

export default LandingHero;
