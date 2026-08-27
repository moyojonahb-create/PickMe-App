import { Shield, Phone, MapPin, Users, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

const safetyFeatures = [
  {
    icon: Shield,
    title: 'Safety features built in',
    description: 'Share your trip status with loved ones and access emergency assistance.',
    accent: 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground',
  },
  {
    icon: Phone,
    title: '24/7 support',
    description: 'Our support team is available around the clock to help.',
    accent: 'bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground',
  },
  {
    icon: MapPin,
    title: 'Real-time tracking',
    description: 'Track your ride in real-time from request to drop-off.',
    accent: 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground',
  },
  {
    icon: Users,
    title: 'Verified drivers',
    description: 'All drivers undergo thorough background checks.',
    accent: 'bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground',
  },
];

const SafetySection = () => {
  return (
    <section className="bg-background py-20 lg:py-28 relative overflow-hidden">
      {/* Subtle pattern */}
      <div className="absolute inset-0 opacity-[0.015]" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)',
        backgroundSize: '32px 32px',
      }} />

      <div className="cruixe-container relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-full text-sm font-semibold mb-6">
            <CheckCircle2 className="w-4 h-4" />
            Your Safety Matters
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold text-foreground mb-5 tracking-tight">
            Your safety drives us
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto leading-relaxed">
            Whether you're riding or driving, we're committed to your safety. Every trip is tracked and our support team is always ready to help.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {safetyFeatures.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="group p-6 rounded-2xl border border-border/40 hover:border-border/80 bg-card hover:shadow-[var(--shadow-lg)] transition-all duration-300 hover:-translate-y-1"
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-5 transition-all duration-300 ${feature.accent}`}>
                <feature.icon className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SafetySection;
