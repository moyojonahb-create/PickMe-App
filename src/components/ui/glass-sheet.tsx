import * as React from "react";
import { cn } from "@/lib/utils";

type GlassSheetProps = React.HTMLAttributes<HTMLDivElement>;

export function GlassSheet({ className, ...props }: GlassSheetProps) {
  return (
    <div
      className={cn(
        "rounded-t-3xl bg-background border-t border-border/40 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]",
        className,
      )}
      {...props}
    />
  );
}
