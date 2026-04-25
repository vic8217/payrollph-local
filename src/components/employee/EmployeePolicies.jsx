import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { BookOpen, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import { format } from 'date-fns';

const categoryLabels = {
  hr: { label: 'HR', color: 'bg-blue-100 text-blue-700' },
  attendance: { label: 'Attendance', color: 'bg-purple-100 text-purple-700' },
  payroll: { label: 'Payroll', color: 'bg-green-100 text-green-700' },
  conduct: { label: 'Code of Conduct', color: 'bg-orange-100 text-orange-700' },
  safety: { label: 'Safety', color: 'bg-red-100 text-red-700' },
  it: { label: 'IT', color: 'bg-cyan-100 text-cyan-700' },
  other: { label: 'Other', color: 'bg-gray-100 text-gray-700' },
};

function PolicyCard({ policy }) {
  const [expanded, setExpanded] = useState(false);
  const cat = categoryLabels[policy.category] || categoryLabels.other;

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button
        className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cat.color}`}>
              {cat.label}
            </span>
            {policy.effective_date && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="w-3 h-3" />
                Effective {format(new Date(policy.effective_date), 'MMM d, yyyy')}
              </span>
            )}
          </div>
          <p className="font-semibold text-foreground text-sm">{policy.title}</p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4">
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{policy.content}</p>
        </div>
      )}
    </div>
  );
}

export default function EmployeePolicies() {
  const [activeCategory, setActiveCategory] = useState('all');

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['company-policies'],
    queryFn: () => appApi.entities.CompanyPolicy.filter({ is_active: true }, 'order', 100),
  });

  const categories = ['all', ...Object.keys(categoryLabels)];
  const filtered = activeCategory === 'all'
    ? policies
    : policies.filter(p => p.category === activeCategory);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="font-bold text-foreground">Policies & Procedures</h2>
          <p className="text-xs text-muted-foreground">Company guidelines and standard operating procedures</p>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {cat === 'all' ? 'All' : categoryLabels[cat]?.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No policies available yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(policy => (
            <PolicyCard key={policy.id} policy={policy} />
          ))}
        </div>
      )}
    </div>
  );
}