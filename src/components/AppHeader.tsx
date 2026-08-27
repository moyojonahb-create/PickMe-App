import { Link } from "react-router-dom";
import CruiXeLogo from "@/components/CruiXeLogo";

/**
 * Slim, consistent white header with the 3x PickMe logo.
 *
 * Used on marketing / static / auth screens that don't have their own
 * full-screen chrome (map shells like /ride, /driver/dashboard intentionally
 * skip this so the map stays edge-to-edge).
 *
 * The logo scales down on phone & tablet so it never crowds out the page.
 */
const AppHeader = () => {
  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b border-border/20 shadow-sm">
      <div className="cruixe-container">
        <div className="flex items-center h-14 sm:h-16 md:h-20 lg:h-[88px]">
          <Link to="/" aria-label="CruiXe home" className="flex items-center -ml-2">
            <CruiXeLogo size="lg" variant="default" />
          </Link>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
