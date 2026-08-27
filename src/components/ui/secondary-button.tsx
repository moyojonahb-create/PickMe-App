import * as React from "react";
import { cn } from "@/lib/utils";

type SecondaryButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const SecondaryButton = React.forwardRef<HTMLButtonElement, SecondaryButtonProps>(
  ({ className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "h-11 rounded-2xl px-4 text-sm font-medium text-foreground bg-card border border-border/40 active:scale-[0.98] transition-all",
          "shadow-cruixe-sm disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  }
);
SecondaryButton.displayName = "SecondaryButton";
