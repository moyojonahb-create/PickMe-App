import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, DollarSign, Clock, Shield, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';

const benefits = [
  {
    icon: DollarSign,
    title: 'Earn on your schedule',
    description: 'Drive when you want—evenings, weekends, or full-time.',
  },
  {
    icon: Clock,
    title: 'Set your own hours',
    description: 'You decide when and how long you drive.',
  },
  {
    icon: Shield,
    title: 'Get support every step',
    description: '24/7 support for drivers on the road.',
  },
];

const stats = [
  { value: '10K+', label: 'Active drivers', icon: '🚗' },
  { value: '50K+', label: 'Trips completed', icon: '✓' },
  { value: '4.9', label: 'Average rating', icon: '⭐' },
  { value: '24/7', label: 'Driver support', icon: '📞' },
];

const DriveSection = () => {
  return (
    <section id="drive" className="relative bg-primary text-primary-foreground py-20 lg:py-28 overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/5 rounded-full blur-[150px]" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-primary-foreground/3 rounded-full blur-[120px]" />

      <div className="cruixe-container relative">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 bg-primary-foreground/10 backdrop-blur-sm border border-primary-foreground/10 px-4 py-2 rounded-full mb-6">
              <TrendingUp className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold">Start Earning</span>
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold mb-6 leading-tight tracking-tight">
              Drive when you want,
              <br />
              earn what you need
            </h2>
            <p className="text-primary-foreground/70 text-lg mb-10 leading-relaxed max-w-lg">
              Join thousands of drivers earning on their own terms. Whether you need extra income or want to make driving your career, CruiXe has you covered.
            </p>

            <div className="space-y-4 mb-10">
              {benefits.map((benefit, i) => (
                <motion.div
                  key={benefit.title}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                  className="flex gap-4 items-start group"
                >
                  <div className="w-11 h-11 rounded-xl bg-primary-foreground/10 flex items-center justify-center shrink-0 group-hover:bg-accent/20 transition-colors">
                    <benefit.icon className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-0.5 text-lg">{benefit.title}</h4>
                    <p className="text-primary-foreground/60 text-sm">{benefit.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90 h-14 px-8 font-bold shadow-[var(--shadow-glow)] group">
                <Link to="/driver">
                  Sign up to drive
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="border-2 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 bg-transparent h-14">
                Learn more
              </Button>
            </div>
          </motion.div>

          {/* Stats Grid */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="grid grid-cols-2 gap-4"
          >
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.3 + i * 0.1 }}
                className="bg-primary-foreground/5 backdrop-blur-sm border border-primary-foreground/10 rounded-2xl p-6 text-center hover:bg-primary-foreground/10 transition-all duration-300 hover:-translate-y-0.5"
              >
                <div className="text-2xl mb-3">{stat.icon}</div>
                <div className="text-3xl lg:text-4xl font-bold mb-1">{stat.value}</div>
                <div className="text-primary-foreground/60 text-sm">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default DriveSection;
