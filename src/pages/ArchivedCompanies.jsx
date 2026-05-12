// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Archive, Building2, RotateCcw } from 'lucide-react';

export default function ArchivedCompanies() {
  const queryClient = useQueryClient();
  const { refreshCompanies } = useCompany();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: archivedCompanies = [], isLoading } = useQuery({
    queryKey: ['archived-company-profiles'],
    queryFn: async () => {
      const list = await appApi.entities.CompanyProfile.list();
      return list.filter((company) => company.status === 'archived');
    },
    enabled: user?.role === 'super_admin',
  });

  const restoreMutation = useMutation({
    mutationFn: (company) => appApi.entities.CompanyProfile.update(company.id, {
      status: 'active',
      restored_at: new Date().toISOString(),
    }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['archived-company-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['company-profiles'] });
      await refreshCompanies();
      toast({ title: 'Company restored' });
    },
  });

  if (user?.role !== 'super_admin') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only Super Admin can view archived companies.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Archived Companies</h1>
        <p className="text-muted-foreground text-sm mt-1">Companies archived by Super Admin are kept here separately.</p>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">Loading...</div>
      ) : archivedCompanies.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Archive className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No archived companies.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {archivedCompanies.map((company) => (
            <Card key={company.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-semibold text-foreground">{company.company_name}</h2>
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200">Archived</Badge>
                      </div>
                      {company.trade_name && <p className="text-sm text-muted-foreground">{company.trade_name}</p>}
                      {company.archived_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Archived {new Date(company.archived_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => restoreMutation.mutate(company)}
                    disabled={restoreMutation.isPending}
                    className="gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
