import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PilotReadinessItem = {
  label: string;
  detail: string;
  done?: boolean;
};

interface PilotReadinessCardProps {
  title: string;
  subtitle: string;
  items: PilotReadinessItem[];
  footer?: ReactNode;
  tone?: "driver" | "rider" | "admin";
}

export default function PilotReadinessCard({
  title,
  subtitle,
  items,
  footer,
  tone = "rider",
}: PilotReadinessCardProps) {
  const completed = items.filter((item) => item.done).length;

  return (
    <section
      className={cn(
        "glass-card rounded-2xl border p-4 shadow-sm",
        tone === "driver" && "border-primary/25 bg-primary/5",
        tone === "rider" && "border-primary/20 bg-background/70",
        tone === "admin" && "border-destructive/20 bg-destructive/5"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
          {completed}/{items.length}
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {items.map((item) => {
          const Icon = item.done ? CheckCircle2 : AlertTriangle;
          return (
            <div key={item.label} className="flex items-start gap-2.5 rounded-xl bg-card/70 px-3 py-2">
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", item.done ? "text-primary" : "text-destructive")} />
              <div className="min-w-0">
                <p className="text-xs font-bold text-foreground">{item.label}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">{item.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {footer && <div className="mt-3">{footer}</div>}
    </section>
  );
}
