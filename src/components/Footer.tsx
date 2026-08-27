import { forwardRef } from 'react';
import { Facebook, Twitter, Instagram, Linkedin, Globe, Mail, Phone, MapPin } from 'lucide-react';
import CruiXeLogo from '@/components/CruiXeLogo';

const footerLinks = {
  company: [
    { label: 'About us', href: '#about' },
    { label: 'Our offerings', href: '#' },
    { label: 'Newsroom', href: '#' },
    { label: 'Investors', href: '#' },
    { label: 'Blog', href: '#' },
    { label: 'Careers', href: '#' },
  ],
  products: [
    { label: 'Ride', href: '#ride' },
    { label: 'Drive', href: '#drive' },
    { label: 'Business', href: '#business' },
    { label: 'CruiXe Eats', href: '#' },
    { label: 'CruiXe Freight', href: '#' },
  ],
  citizenship: [
    { label: 'Safety', href: '#' },
    { label: 'Diversity', href: '#' },
    { label: 'Sustainability', href: '#' },
  ],
  travel: [
    { label: 'Airports', href: '#' },
    { label: 'Cities', href: '#' },
  ],
};

const socialLinks = [
  { icon: Facebook, href: '#', label: 'Facebook' },
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Instagram, href: '#', label: 'Instagram' },
  { icon: Linkedin, href: '#', label: 'LinkedIn' },
];

const Footer = forwardRef<HTMLElement>((_props, ref) => {
  return (
    <footer ref={ref} className="bg-primary text-primary-foreground">
      <div className="cruixe-container py-14 lg:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10 mb-14">
          <div className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0">
            <a href="/" className="inline-block">
              <CruiXeLogo variant="inverted" showTagline />
            </a>
          </div>

          <div>
            <h4 className="font-bold mb-5">Company</h4>
            <ul className="space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors duration-200">{link.label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-5">Products</h4>
            <ul className="space-y-3">
              {footerLinks.products.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors duration-200">{link.label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-5">Citizenship</h4>
            <ul className="space-y-3">
              {footerLinks.citizenship.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors duration-200">{link.label}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-5">Travel</h4>
            <ul className="space-y-3">
              {footerLinks.travel.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors duration-200">{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-primary-foreground/20 pt-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              {socialLinks.map((social) => (
                <a key={social.label} href={social.href} aria-label={social.label} className="w-11 h-11 bg-primary-foreground/10 rounded-full flex items-center justify-center hover:bg-primary-foreground/20 transition-all duration-200 hover:scale-105">
                  <social.icon className="w-5 h-5" />
                </a>
              ))}
            </div>
            <button className="flex items-center gap-2 text-sm font-medium hover:text-primary-foreground/80 transition-colors px-4 py-2 rounded-full hover:bg-primary-foreground/10">
              <Globe className="w-4 h-4" />
              <span>English</span>
            </button>
          </div>

          <div className="flex flex-col gap-6 mt-10">
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-primary-foreground/80">
              <a href="mailto:info@pickme.co.zw" className="flex items-center gap-2 hover:text-primary-foreground transition-colors">
                <Mail className="w-4 h-4" />info@pickme.co.zw
              </a>
              <a href="tel:+263778553169" className="flex items-center gap-2 hover:text-primary-foreground transition-colors">
                <Phone className="w-4 h-4" />+263 778 553 169
              </a>
              <span className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />Zimbabwe
              </span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-primary-foreground/60">
              <span>© 2026 CruiXe. Powered by Tautona Tek</span>
              <a href="/privacy" className="hover:text-primary-foreground transition-colors">Privacy</a>
              <a href="/terms" className="hover:text-primary-foreground transition-colors">Terms</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';

export default Footer;
