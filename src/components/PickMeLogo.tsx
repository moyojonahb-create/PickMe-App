import { forwardRef } from 'react';
import pickmeLogo from '@/assets/pickme-logo.png';

interface PickMeLogoProps {
  className?: string;
  variant?: 'default' | 'inverted' | 'light';
  showTagline?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  iconOnly?: boolean;
}

const sizeClasses = {
  sm: 'h-8',
  md: 'h-10',
  // Header logo — compact on mobile, scales up moderately on larger screens
  lg: 'h-10 sm:h-11 md:h-12 lg:h-[52px]',
  xl: 'h-16 sm:h-20 md:h-24 lg:h-28',
};

const PickMeLogo = forwardRef<HTMLDivElement, PickMeLogoProps>(({ 
  className = '', 
  variant = 'default', 
  showTagline = false,
  size = 'md',
}, ref) => {
  const isLight = variant === 'inverted' || variant === 'light';

  return (
    <div ref={ref} className={`flex items-center gap-2 ${className}`}>
      <img 
        src={pickmeLogo} 
        alt="PickMe" 
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

PickMeLogo.displayName = 'PickMeLogo';

export default PickMeLogo;
