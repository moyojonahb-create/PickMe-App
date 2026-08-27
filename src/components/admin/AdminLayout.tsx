import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Car, 
  MapPin, 
  FileBarChart, 
  Settings, 
  Navigation,
  Bell,
  LogOut,
  Menu,
  X,
  Banknote,
  Activity,
  GraduationCap
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import CruiXeLogo from '@/components/CruiXeLogo';

interface AdminLayoutProps {
  children: ReactNode;
}

const navItems = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Drivers', href: '/admin/drivers', icon: Car },
  { label: 'Trips', href: '/admin/trips', icon: Navigation },
  { label: 'Landmarks', href: '/admin/landmarks', icon: MapPin },
  { label: 'Promos', href: '/admin/promos', icon: Bell },
  { label: 'Wallet', href: '/admin/wallet', icon: Banknote },
  { label: 'Driver Deposits', href: '/admin/deposits', icon: Banknote },
  { label: 'Rider Deposits', href: '/admin/rider-deposits', icon: Banknote },
  { label: 'Withdrawals', href: '/admin/withdrawals', icon: Banknote },
  { label: 'Ledger', href: '/admin/ledger', icon: Banknote },
  { label: 'Reports', href: '/admin/reports', icon: FileBarChart },
  { label: 'Town Pricing', href: '/admin/town-pricing', icon: Banknote },
  { label: 'Students', href: '/admin/students', icon: GraduationCap },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
  { label: 'System Health', href: '/admin/system-health', icon: Activity },
];

const AdminLayout = ({ children }: AdminLayoutProps) => {
  const location = useLocation();
  const { signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/admin') {
      return location.pathname === '/admin';
    }
    return location.pathname.startsWith(href);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r border-border flex flex-col transition-transform duration-200 lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border">
          <Link to="/admin" className="flex items-center gap-2">
            <CruiXeLogo />
            <span className="text-xs font-medium text-muted-foreground bg-accent/10 px-2 py-0.5 rounded">
              Admin
            </span>
          </Link>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 hover:bg-secondary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-2">
          <Link 
            to="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <MapPin className="w-5 h-5" />
            Back to App
          </Link>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-card border-b border-border flex items-center justify-between px-4 lg:px-6">
          <button 
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 hover:bg-secondary rounded-lg"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4 ml-auto">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
