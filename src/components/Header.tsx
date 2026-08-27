import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import CruiXeLogo from "@/components/CruiXeLogo";
import UserMenu from "@/components/UserMenu";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useAuth } from "@/hooks/useAuth";

interface HeaderProps {
  onLoginClick: () => void;
  onSignupClick: () => void;
  onFavoritesClick: () => void;
  onHistoryClick: () => void;
  transparent?: boolean;
}

const Header = ({ onLoginClick, onSignupClick, onFavoritesClick, onHistoryClick, transparent = false }: HeaderProps) => {
  const { user, loading } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { label: "Ride", href: "#ride" },
    { label: "Drive", href: "#drive" },
    { label: "Business", href: "#business" },
    { label: "About", href: "#about" },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 bg-white transition-all duration-300 ${
        scrolled
          ? 'border-b border-border/40 shadow-md'
          : 'border-b border-border/10 shadow-none'
      }`}
    >
      <div className="cruixe-container">
        <nav
          className={`flex items-center justify-between transition-all duration-300 ${
            scrolled
              ? 'h-12 sm:h-14 md:h-[60px] lg:h-[68px]'
              : 'h-14 sm:h-16 md:h-[68px] lg:h-[76px]'
          }`}
        >
          <a href="/" className="shrink-0 -ml-2 flex items-center">
            <CruiXeLogo size="lg" variant="default" />
          </a>

          <div className="hidden lg:flex items-center gap-0.5 ml-6">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-[14px] font-semibold px-3.5 py-2 rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="hidden lg:flex items-center gap-1.5">
            <LanguageSwitcher />
            <a
              href="#help"
              className="text-[14px] font-medium px-3 py-2 rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
            >
              Help
            </a>
            {!loading &&
              (user ? (
                <UserMenu onFavoritesClick={onFavoritesClick} onHistoryClick={onHistoryClick} />
              ) : (
                <>
                  <button
                    onClick={onLoginClick}
                    className="text-[14px] font-medium px-3 py-2 rounded-lg text-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
                  >
                    Log in
                  </button>
                  <Button onClick={onSignupClick} variant="accent" size="sm" className="font-bold h-9 px-4">
                    Sign up
                  </Button>
                </>
              ))}
          </div>

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg active:scale-90 transition-all text-foreground hover:bg-muted/50"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </nav>

        {isMobileMenuOpen && (
          <div className="lg:hidden py-3 border-t border-border/20 animate-slide-down">
            <div className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="px-4 py-3 text-[15px] text-foreground font-semibold hover:bg-muted/50 rounded-lg transition-colors active:scale-[0.98]"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
              <div className="border-t border-border/20 my-2" />
              <a href="#help" className="px-4 py-3 text-[14px] text-foreground/80 font-medium hover:bg-muted/50 rounded-lg transition-colors">
                Help
              </a>
              <div className="px-2"><LanguageSwitcher /></div>
              <div className="border-t border-border/20 my-2" />
              {!loading &&
                (user ? (
                  <div className="px-3">
                    <UserMenu
                      onFavoritesClick={() => { setIsMobileMenuOpen(false); onFavoritesClick(); }}
                      onHistoryClick={() => { setIsMobileMenuOpen(false); onHistoryClick(); }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 px-3 pb-1">
                    <Button onClick={() => { setIsMobileMenuOpen(false); onLoginClick(); }} variant="outline" size="default" className="w-full h-11">
                      Log in
                    </Button>
                    <Button onClick={() => { setIsMobileMenuOpen(false); onSignupClick(); }} variant="accent" size="default" className="w-full h-11">
                      Sign up
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
