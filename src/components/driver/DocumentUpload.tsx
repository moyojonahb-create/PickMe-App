import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createDriverDocument } from '@/lib/businessApi';

interface Document {
  id: string;
  document_type: string;
  file_url: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

const requiredDocuments = [
  { type: 'drivers_license', label: "Driver's License", description: 'Valid driver license (front and back)' },
  { type: 'vehicle_registration', label: 'Vehicle Registration', description: 'Vehicle registration certificate' },
  { type: 'insurance', label: 'Insurance', description: 'Valid vehicle insurance document' },
  { type: 'police_clearance', label: 'Police Clearance', description: 'Police clearance certificate' },
];

interface DocumentUploadProps {
  driverId: string;
}

const DocumentUpload = ({ driverId }: DocumentUploadProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['driver-documents', driverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_documents')
        .select('*')
        .eq('driver_id', driverId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Document[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File; documentType: string }) => {
      if (!user) throw new Error('Not authenticated');

      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${documentType}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('driver-documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Store only the file path (not public URL) through Go.
      await createDriverDocument({
        driver_id: driverId,
        document_type: documentType,
        file_url: filePath, // Store path, not public URL
        status: 'pending',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-documents', driverId] });
      toast({
        title: 'Document uploaded',
        description: 'Your document has been submitted for review.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Upload failed',
        description: error.message || 'Failed to upload document',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setUploadingType(null);
    },
  });

  const handleFileSelect = (documentType: string, file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please select a file smaller than 5MB',
        variant: 'destructive',
      });
      return;
    }

    setUploadingType(documentType);
    uploadMutation.mutate({ file, documentType });
  };

  const getDocumentForType = (type: string) => {
    return documents.find((doc) => doc.document_type === type);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-accent/80 text-accent-foreground"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-accent/10">
            <FileText className="h-6 w-6 text-accent" />
          </div>
          <div>
            <CardTitle>Required Documents</CardTitle>
            <CardDescription>Upload all required documents for verification</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {requiredDocuments.map((doc) => {
          const uploadedDoc = getDocumentForType(doc.type);
          const isUploading = uploadingType === doc.type;

          return (
            <div
              key={doc.type}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="flex-1">
                <p className="font-medium">{doc.label}</p>
                <p className="text-sm text-muted-foreground">{doc.description}</p>
                {uploadedDoc?.status === 'rejected' && uploadedDoc.rejection_reason && (
                  <p className="text-sm text-destructive mt-1">
                    Reason: {uploadedDoc.rejection_reason}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                {uploadedDoc && getStatusBadge(uploadedDoc.status)}

                <input
                  type="file"
                  ref={(el) => (fileInputRefs.current[doc.type] = el)}
                  className="hidden"
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(doc.type, file);
                  }}
                />

                <Button
                  variant={uploadedDoc ? 'outline' : 'default'}
                  size="sm"
                  disabled={isUploading}
                  onClick={() => fileInputRefs.current[doc.type]?.click()}
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : uploadedDoc ? (
                    'Re-upload'
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default DocumentUpload;
