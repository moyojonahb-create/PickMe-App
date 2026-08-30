import { forwardRef } from 'react';

interface CruiXeLogoProps {
  className?: string;
  variant?: 'default' | 'inverted' | 'light';
  showTagline?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  iconOnly?: boolean;
}

const sizeClasses = {
  xs: 'h-5',
  sm: 'h-8',
  md: 'h-10',
  // Header logo — compact on mobile, scales up moderately on larger screens
  lg: 'h-10 sm:h-11 md:h-12 lg:h-[52px]',
  xl: 'h-16 sm:h-20 md:h-24 lg:h-28',
};

const CruiXeLogo = forwardRef<HTMLDivElement, CruiXeLogoProps>(({
  className = '',
  variant = 'default',
  showTagline = false,
  size = 'md',
}, ref) => {
  const isLight = variant === 'inverted' || variant === 'light';
  // White wordmark for red/dark backgrounds (inverted, light), red wordmark
  // for white/light backgrounds (default) — was previously a single static
  // image regardless of variant, so "inverted" never actually inverted.
  const logoSrc = isLight
    ? '/brand/cruixe-logo-white-transparent.png'
    : '/brand/cruixe-logo-red-transparent.png';

  return (
    <div ref={ref} className={`flex items-center gap-2 ${className}`}>
      <img
        src={logoSrc}
        alt="CruiXe"
        className={`${sizeClasses[size]} w-auto object-contain`}
      />

      {showTagline && (
        <span className={`text-xs ${isLight ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          Your ride, your way.
        </span>
      )}
    </div>
  );
});

CruiXeLogo.displayName = 'CruiXeLogo';

export default CruiXeLogo;
