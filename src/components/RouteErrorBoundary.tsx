import React, { Component, ErrorInfo, ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageSkeleton from "@/components/PageSkeleton";

interface Props {
  children: ReactNode;
  variant?: "ride" | "wallet" | "profile" | "admin" | "generic";
}

interface State {
  hasError: boolean;
  error: Error | null;
  attempt: number;
}

/**
 * Non-blocking route error boundary.
 *
 * When a child throws (lazy chunk load failure, data fetch error, render
 * crash), we keep the page skeleton visible underneath and float a small
 * retry banner on top — so the user never sees a blank white screen.
 */
class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RouteErrorBoundary:", error, info);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  private handleRetry = () => {
    this.setState((s) => ({ hasError: false, error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative">
          <PageSkeleton variant={this.props.variant ?? "generic"} />
          <div
            role="alert"
            className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 max-w-sm w-[calc(100%-2rem)]
                       bg-background border border-border shadow-2xl rounded-2xl p-4
                       animate-in slide-in-from-bottom-4 fade-in duration-300"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">Couldn't load this screen</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {this.state.error?.message ?? "Network or app error."}
                </p>
                <Button onClick={this.handleRetry} size="sm" className="mt-3 h-8">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}

export default RouteErrorBoundary;
