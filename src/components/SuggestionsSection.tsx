import { Car, Wallet, Briefcase, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';

const suggestions = [
  {
    id: 'ride',
    icon: Car,
    title: 'Ride',
    description: 'Go anywhere with CruiXe. Request a ride, hop in, and go.',
    href: '#ride',
    gradient: 'from-primary/10 to-primary/5',
    iconBg: 'bg-primary/10 text-primary',
  },
  {
    id: 'drive',
    icon: Wallet,
    title: 'Drive & Earn',
    description: 'Make money on your schedule. Drive when you want, earn what you need.',
    href: '#drive',
    gradient: 'from-accent/10 to-accent/5',
    iconBg: 'bg-accent/15 text-accent',
  },
  {
    id: 'business',
    icon: Briefcase,
    title: 'CruiXe Business',
    description: 'Transform the way your company moves and feeds its people.',
    href: '#business',
    gradient: 'from-secondary to-muted/50',
    iconBg: 'bg-foreground/10 text-foreground',
  },
];

const SuggestionsSection = () => {
  return (
    <section className="bg-background py-16 lg:py-24 -mt-1">
      <div className="cruixe-container">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {suggestions.map((item, index) => (
            <motion.a
              key={item.id}
              href={item.href}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={`group relative block p-7 rounded-2xl bg-gradient-to-br ${item.gradient} border border-border/40 hover:border-border/80 transition-all duration-300 hover:shadow-[var(--shadow-lg)] hover:-translate-y-1`}
            >
              <div className="absolute top-5 right-5 w-9 h-9 bg-card rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shadow-sm">
                <ArrowUpRight className="w-4 h-4 text-foreground" />
              </div>

              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-5 ${item.iconBg} transition-all duration-300`}>
                <item.icon className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">
                {item.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {item.description}
              </p>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SuggestionsSection;
