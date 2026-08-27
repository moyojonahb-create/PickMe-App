/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { format, startOfDay, startOfWeek, startOfMonth, isAfter } from 'date-fns';
import { TrendingUp, Calendar, DollarSign } from 'lucide-react';

interface AdminEarning {
  id: string;
  ride_id: string | null;
  driver_id: string;
  fare_amount: number;
  platform_fee: number;
  driver_earnings: number;
  created_at: string;
}

interface AdminEarningsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  earnings: AdminEarning[];
  totalFares: number;
  totalPlatformFees: number;
}

function sumField(items: AdminEarning[], field: 'fare_amount' | 'platform_fee' | 'driver_earnings') {
  return items.reduce((acc, e) => acc + Number(e[field]), 0);
}

export default function AdminEarningsSheet({
  isOpen,
  onClose,
  earnings,
  totalFares,
  totalPlatformFees,
}: AdminEarningsSheetProps) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('today');

  const now = new Date();
  const periodStart = useMemo(() => {
    switch (period) {
      case 'today': return startOfDay(now);
      case 'week': return startOfWeek(now, { weekStartsOn: 1 });
      case 'month': return startOfMonth(now);
      default: return new Date(0);
    }
  }, [period]);

  const filtered = useMemo(
    () => earnings.filter((e) => isAfter(new Date(e.created_at), periodStart)),
    [earnings, periodStart]
  );

  const periodFares = sumField(filtered, 'fare_amount');
  const periodFees = sumField(filtered, 'platform_fee');
  const periodDriverEarnings = sumField(filtered, 'driver_earnings');
  const tripCount = filtered.length;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            CruiXe Commission Revenue
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Period Tabs */}
          <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="all">All Time</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Revenue Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-primary/10 rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <DollarSign className="h-4 w-4 text-primary" />
                <p className="text-xs text-muted-foreground font-semibold">CruiXe Revenue (15%)</p>
              </div>
              <p className="text-2xl font-black text-primary">${periodFees.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{tripCount} trips</p>
            </div>
            <div className="bg-accent/10 rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Calendar className="h-4 w-4 text-accent" />
                <p className="text-xs text-muted-foreground font-semibold">Total Fares</p>
              </div>
              <p className="text-2xl font-black text-accent">${periodFares.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Driver keeps ${periodDriverEarnings.toFixed(2)}</p>
            </div>
          </div>

          {/* All-time summary bar */}
          <div className="flex items-center justify-between bg-muted rounded-xl px-4 py-3">
            <span className="text-xs font-semibold text-muted-foreground">All-Time CruiXe Revenue</span>
            <span className="font-black text-primary">${totalPlatformFees.toFixed(2)}</span>
          </div>

          {/* Earnings Table */}
          <div className="overflow-auto max-h-[calc(85vh-380px)] rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Fare</TableHead>
                  <TableHead>Commission (15%)</TableHead>
                  <TableHead>Driver Gets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No earnings for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">
                        {format(new Date(e.created_at), 'dd MMM, HH:mm')}
                      </TableCell>
                      <TableCell className="font-medium">
                        ${Number(e.fare_amount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-primary font-bold">
                        ${Number(e.platform_fee).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-medium">
                        ${Number(e.driver_earnings).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
