import { Button } from '@/components/ui/button';
import { ArrowRight, Building2, Receipt, Users2, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

const features = [
  {
    icon: Building2,
    title: 'Central billing',
    description: 'Manage all employee rides from one dashboard with detailed reporting.',
  },
  {
    icon: Receipt,
    title: 'Expense tracking',
    description: 'Automatic receipt generation and expense categorization.',
  },
  {
    icon: Users2,
    title: 'Team management',
    description: 'Add employees, set policies, and control spending limits.',
  },
];

const BusinessSection = () => {
  return (
    <section id="business" className="bg-background py-20 lg:py-28">
      <div className="cruixe-container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-full text-sm font-semibold mb-6">
              <Building2 className="w-4 h-4" />
              CruiXe for Business
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold text-foreground mb-6 leading-tight tracking-tight">
              Transform how your company moves
            </h2>
            <p className="text-muted-foreground text-lg mb-10 leading-relaxed max-w-lg">
              Give your team the flexibility to travel on their terms while keeping complete control over costs.
            </p>

            <div className="space-y-4 mb-10">
              {features.map((feature, i) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, x: -15 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                  className="flex gap-4 items-start group"
                >
                  <div className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                    <feature.icon className="w-5 h-5 text-foreground group-hover:text-accent transition-colors" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground mb-0.5 text-lg">{feature.title}</h4>
                    <p className="text-muted-foreground text-sm">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <Button variant="accent" size="lg" className="h-14 px-8 group">
              Get started
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </motion.div>

          {/* Dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="bg-gradient-to-br from-muted/50 to-secondary/80 rounded-3xl p-6 lg:p-8 border border-border/40"
          >
            <div className="bg-card rounded-2xl shadow-[var(--shadow-md)] p-5 mb-5 border border-border/30">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground font-medium">This month</span>
                <span className="inline-flex items-center gap-1.5 bg-accent/10 text-accent text-xs font-semibold px-3 py-1 rounded-full">
                  <TrendingDown className="w-3 h-3" />
                  12% savings
                </span>
              </div>
              <div className="text-4xl font-bold text-foreground mb-0.5">
                $2,450<span className="text-lg text-muted-foreground">.00</span>
              </div>
              <div className="text-sm text-muted-foreground">Total spending</div>

              {/* Mini chart */}
              <div className="flex items-end gap-1 mt-4 h-12">
                {[35, 50, 40, 60, 45, 70, 55, 80, 65, 75, 60, 50].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-primary/15 hover:bg-primary/30 transition-colors"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card rounded-xl p-4 border border-border/30 shadow-sm">
                <div className="text-2xl font-bold text-foreground mb-0.5">156</div>
                <div className="text-xs text-muted-foreground">Total trips</div>
              </div>
              <div className="bg-card rounded-xl p-4 border border-border/30 shadow-sm">
                <div className="text-2xl font-bold text-foreground mb-0.5">24</div>
                <div className="text-xs text-muted-foreground">Active users</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default BusinessSection;
