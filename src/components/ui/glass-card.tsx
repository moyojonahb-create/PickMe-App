import * as React from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = React.HTMLAttributes<HTMLDivElement> & {
  intense?: boolean;
};

export function GlassCard({ className, intense = false, ...props }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-border/40 bg-card shadow-cruixe-sm",
        intense && "shadow-cruixe-md",
        className,
      )}
      {...props}
    />
  );
}
