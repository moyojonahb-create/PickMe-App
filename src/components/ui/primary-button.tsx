import * as React from "react";
import { cn } from "@/lib/utils";

type PrimaryButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "relative h-12 rounded-2xl px-6 text-[15px] font-bold text-primary-foreground active:scale-[0.97] transition-all duration-150 overflow-hidden",
          "disabled:opacity-50",
          className,
        )}
        style={{
          background: 'var(--gradient-primary)',
          boxShadow: 'var(--shadow-btn-primary)',
        }}
        {...props}
      />
    );
  }
);
PrimaryButton.displayName = "PrimaryButton";
