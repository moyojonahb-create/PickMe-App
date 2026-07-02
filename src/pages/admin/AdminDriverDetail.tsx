import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Car, 
  Phone, 
  Mail, 
  Star, 
  Navigation,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabaseClient';
import { adminUpdateRow } from '@/lib/businessApi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Driver {
  id: string;
  user_id: string;
  status: string;
  vehicle_type: string;
  plate_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  rating_avg: number;
  total_trips: number;
  is_online: boolean;
  created_at: string;
  updated_at: string;
}

interface Profile {
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
}

interface Document {
  id: string;
  document_type: string;
  file_url: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-red-100 text-red-700',
  banned: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-700',
};

const documentLabels: Record<string, string> = {
  license: "Driver's License",
  registration: 'Vehicle Registration',
  insurance: 'Insurance Certificate',
  id_card: 'National ID Card',
};

const AdminDriverDetail = () => {
  const { driverId } = useParams();
  const navigate = useNavigate();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    const fetchDriverDetails = async () => {
      if (!driverId) return;

      try {
        // Fetch driver
        const { data: driverData, error: driverError } = await supabase
          .from('drivers')
          .select('*')
          .eq('id', driverId)
          .single();

        if (driverError) throw driverError;
        setDriver(driverData);

        // Fetch profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name, phone, avatar_url')
          .eq('user_id', driverData.user_id)
          .maybeSingle();

        setProfile(profileData);

        // Fetch documents
        const { data: docsData } = await supabase
          .from('driver_documents')
          .select('*')
          .eq('driver_id', driverId)
          .order('created_at', { ascending: false });

        setDocuments(docsData || []);
      } catch (error) {
        console.error('Error fetching driver details:', error);
        toast.error('Failed to load driver details');
      } finally {
        setLoading(false);
      }
    };

    fetchDriverDetails();
  }, [driverId]);

  const handleStatusChange = async (newStatus: string) => {
    if (!driver) return;
    setActionLoading(true);

    try {
      await adminUpdateRow('drivers', driver.id, { status: newStatus });

      setDriver({ ...driver, status: newStatus });
      toast.success(`Driver ${newStatus}`);
    } catch (error) {
      console.error('Error updating driver:', error);
      toast.error('Failed to update driver status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDocumentAction = async (docId: string, action: 'approved' | 'rejected') => {
    setActionLoading(true);

    try {
      const updateData: { status: string; reviewed_at: string; rejection_reason?: string } = {
        status: action,
        reviewed_at: new Date().toISOString(),
      };

      if (action === 'rejected' && rejectionReason) {
        updateData.rejection_reason = rejectionReason;
      }

      await adminUpdateRow('driver_documents', docId, updateData);

      setDocuments(documents.map(doc => 
        doc.id === docId ? { ...doc, status: action } : doc
      ));
      setRejectionReason('');
      toast.success(`Document ${action}`);
    } catch (error) {
      console.error('Error updating document:', error);
      toast.error('Failed to update document');
    } finally {
      setActionLoading(false);
    }
  };

  const pendingDocs = documents.filter(d => d.status === 'pending');

  const handleBatchApprove = async () => {
    if (pendingDocs.length === 0) return;
    setActionLoading(true);

    try {
      const pendingIds = pendingDocs.map(d => d.id);
      await Promise.all(pendingIds.map((id) => adminUpdateRow('driver_documents', id, {
        status: 'approved',
        reviewed_at: new Date().toISOString(),
      })));

      setDocuments(documents.map(doc =>
        pendingIds.includes(doc.id) ? { ...doc, status: 'approved' } : doc
      ));
      toast.success(`${pendingIds.length} document${pendingIds.length > 1 ? 's' : ''} approved`);
    } catch (error) {
      console.error('Error batch approving:', error);
      toast.error('Failed to approve documents');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <AdminGuard>
        <AdminLayout>
          <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid lg:grid-cols-3 gap-6">
              <Skeleton className="h-64 lg:col-span-1" />
              <Skeleton className="h-64 lg:col-span-2" />
            </div>
          </div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  if (!driver) {
    return (
      <AdminGuard>
        <AdminLayout>
          <div className="text-center py-12">
            <AlertTriangle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Driver Not Found</h2>
            <p className="text-muted-foreground mb-4">The driver you're looking for doesn't exist.</p>
            <Button onClick={() => navigate('/admin/drivers')}>
              Back to Drivers
            </Button>
          </div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin/drivers')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">
                {profile?.full_name || 'Unknown Driver'}
              </h1>
              <p className="text-muted-foreground">
                Joined {format(new Date(driver.created_at), 'MMMM d, yyyy')}
              </p>
            </div>
            <Badge className={cn("capitalize", statusColors[driver.status])}>
              {driver.status}
            </Badge>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Profile Card */}
            <div className="bg-card rounded-xl border border-border p-6 space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center">
                  <Car className="w-8 h-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold">{profile?.full_name || 'Unknown'}</p>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Star className="w-4 h-4 text-amber-500" />
                    <span>{Number(driver.rating_avg).toFixed(1)}</span>
                    <span>•</span>
                    <span>{driver.total_trips} trips</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {profile?.phone && (
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{profile.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 text-sm">
                  <Car className="w-4 h-4 text-muted-foreground" />
                  <span className="capitalize">
                    {driver.vehicle_make} {driver.vehicle_model} ({driver.vehicle_type})
                  </span>
                </div>
                {driver.plate_number && (
                  <div className="flex items-center gap-3 text-sm">
                    <Navigation className="w-4 h-4 text-muted-foreground" />
                    <span>{driver.plate_number}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 text-sm">
                  <div className={cn(
                    "w-3 h-3 rounded-full",
                    driver.is_online ? "bg-emerald-500" : "bg-gray-400"
                  )} />
                  <span>{driver.is_online ? 'Currently Online' : 'Offline'}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-4 border-t border-border">
                {driver.status === 'pending' && (
                  <Button 
                    className="w-full" 
                    onClick={() => handleStatusChange('approved')}
                    disabled={actionLoading}
                  >
                    {actionLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Approve Driver
                  </Button>
                )}
                {driver.status === 'approved' && (
                  <Button 
                    variant="destructive" 
                    className="w-full"
                    onClick={() => handleStatusChange('suspended')}
                    disabled={actionLoading}
                  >
                    {actionLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Suspend Driver
                  </Button>
                )}
                {driver.status === 'suspended' && (
                  <>
                    <Button 
                      className="w-full"
                      onClick={() => handleStatusChange('approved')}
                      disabled={actionLoading}
                    >
                      Reactivate Driver
                    </Button>
                    <Button 
                      variant="destructive" 
                      className="w-full"
                      onClick={() => handleStatusChange('banned')}
                      disabled={actionLoading}
                    >
                      Ban Permanently
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Documents */}
            <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-foreground">Verification Documents</h2>
                {pendingDocs.length > 1 && (
                  <Button
                    size="sm"
                    onClick={handleBatchApprove}
                    disabled={actionLoading}
                    className="font-bold gap-1.5"
                  >
                    {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve All ({pendingDocs.length})
                  </Button>
                )}
              </div>
              
              {documents.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No documents uploaded yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {documents.map((doc) => (
                    <div 
                      key={doc.id}
                      className="p-4 bg-secondary/50 rounded-lg space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <FileText className="w-8 h-8 text-muted-foreground" />
                          <div>
                            <p className="font-medium">
                              {documentLabels[doc.document_type] || doc.document_type}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Uploaded {format(new Date(doc.created_at), 'MMM d, yyyy')}
                            </p>
                            {doc.rejection_reason && (
                              <p className="text-sm text-destructive mt-1">
                                Rejected: {doc.rejection_reason}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={cn("capitalize", statusColors[doc.status])}>
                            {doc.status}
                          </Badge>
                          {doc.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDocumentAction(doc.id, 'approved')}
                                disabled={actionLoading}
                              >
                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost" disabled={actionLoading}>
                                    <XCircle className="w-4 h-4 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Reject Document</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Please provide a reason for rejecting this document.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <Textarea
                                    placeholder="Enter rejection reason..."
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                  />
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDocumentAction(doc.id, 'rejected')}
                                      className="bg-destructive hover:bg-destructive/90"
                                    >
                                      Reject
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Document Preview */}
                      {doc.file_url && (
                        <div className="rounded-lg overflow-hidden border border-border bg-muted/30">
                          {doc.file_url.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? (
                            <img
                              src={doc.file_url}
                              alt={documentLabels[doc.document_type] || doc.document_type}
                              className="w-full max-h-64 object-contain"
                              loading="lazy"
                            />
                          ) : doc.file_url.match(/\.pdf$/i) ? (
                            <div className="p-4 flex items-center justify-center gap-3">
                              <FileText className="w-6 h-6 text-primary" />
                              <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary hover:underline">
                                View PDF Document
                              </a>
                            </div>
                          ) : (
                            <div className="p-4 flex items-center justify-center gap-3">
                              <FileText className="w-6 h-6 text-muted-foreground" />
                              <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary hover:underline">
                                Download Document
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminDriverDetail;
