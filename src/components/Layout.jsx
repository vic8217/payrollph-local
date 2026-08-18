import { Outlet, NavLink } from 'react-router-dom';
import { appApi } from '@/lib/appApi';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
		  LayoutDashboard, Users, Clock, CreditCard,
		  CalendarDays, QrCode, FileText, ChevronLeft, ChevronRight,
		  LogOut, Menu, Building2, MonitorSmartphone, CalendarOff, KeyRound, Settings, CalendarClock, ChevronDown, Landmark, Activity, Palmtree, Gift, DoorOpen, Archive, AlertTriangle, ShieldCheck, ReceiptText, BadgeDollarSign, ListChecks, Calculator, BarChart3
		} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useCompany } from '@/lib/CompanyContext';
import { useAuth } from '@/lib/AuthContext';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { canReceiveBreakTimeAlerts, employeesMissingBreakTime } from '@/lib/breakTimeRequirements';
import { manilaDateString } from '@/lib/dateUtils';

// super_admin = all access
// admin = all except daily passcode & user management
// user = HR officer level (same as admin minus passcode/user mgmt, but admin approves)
const navItems = [
  { label: 'Dashboard',       icon: LayoutDashboard,  path: '/',                  roles: ['super_admin', 'admin', 'user'] },
  { label: 'Employees',       icon: Users,             path: '/employees',          roles: ['super_admin', 'admin', 'user'] },
  { label: 'Agency',          icon: Building2,          path: '/agency',             roles: ['super_admin', 'admin', 'user'], agencyOnly: true },
  { label: 'Attendance',      icon: Clock,             path: '/attendance',         roles: ['super_admin', 'admin', 'user'] },
  { label: 'Time In Reviews', icon: ShieldCheck,       path: '/attendance/time-in-reviews', roles: ['super_admin', 'admin', 'user'] },
  { label: 'Work Schedule',   icon: CalendarClock,     path: '/work-schedule',      roles: ['super_admin', 'admin', 'user'] },
  { label: 'Payroll',         icon: FileText,          path: '/payroll',            roles: ['super_admin', 'admin', 'user'] },
  { label: 'Management Reports', icon: BarChart3,      path: '/management-reports', roles: ['super_admin', 'admin', 'user'] },
  { label: 'Special Rates',   icon: BadgeDollarSign,   path: '/special-rates',      roles: ['super_admin', 'admin'] },
  { label: 'Special Payroll', icon: Calculator,        path: '/special-rate-payroll', roles: ['super_admin', 'admin'] },
  { label: '13th Month Pay',  icon: Gift,              path: '/thirteenth-month-pay', roles: ['super_admin', 'admin', 'user'] },
  { label: 'Separation Pay',  icon: DoorOpen,          path: '/separation-pay',     roles: ['super_admin', 'admin', 'user'] },
  { label: 'Statutory Rates', icon: Landmark,          path: '/statutory-rates',    roles: ['super_admin', 'admin', 'user'] },
  { label: 'Mandatory Deductions', icon: ListChecks,   path: '/mandatory-deductions', roles: ['super_admin', 'admin', 'user'] },
  { label: 'Cash Advance',    icon: CreditCard,        path: '/cash-advance',       roles: ['super_admin', 'admin', 'user'] },
  { label: 'Personal Leave',  icon: Palmtree,         path: '/personal-leave',     roles: ['super_admin', 'admin', 'user'] },
  { label: 'Holidays',        icon: CalendarDays,      path: '/holidays',           roles: ['super_admin', 'admin', 'user'] },
  { label: 'No-Work Days',    icon: CalendarOff,       path: '/no-work-days',       roles: ['super_admin', 'admin', 'user'] },
  { label: 'Daily Passcode',  icon: KeyRound,          path: '/passcode-manager',   roles: ['super_admin', 'admin', 'user'] },
  { label: 'User Management', icon: Users,             path: '/user-management',    roles: ['super_admin', 'admin'] },
  { label: 'Users Log',       icon: Activity,          path: '/users-log',          roles: ['super_admin'] },
  { label: 'Passcode Audit',  icon: ShieldCheck,       path: '/passcode-audit',     roles: ['super_admin', 'admin'] },
  { label: 'Payslip Receipts', icon: ReceiptText,       path: '/payslip-acknowledgements', roles: ['super_admin', 'admin', 'user'] },
  { label: 'Company Profile', icon: Building2,         path: '/company-profile',    roles: ['super_admin', 'admin', 'user'] },
  { label: 'Archived Companies', icon: Archive,         path: '/archived-companies', roles: ['super_admin'] },
  { label: 'Shift Settings',  icon: Settings,          path: '/settings',           roles: ['super_admin', 'admin'] },
  { label: 'Portal QR Code',  icon: QrCode,            path: '/employee-portal-qr', roles: ['super_admin', 'admin', 'user'] },
  { label: 'Employee Portal', icon: MonitorSmartphone, path: '/employee-portal',    roles: ['super_admin', 'admin', 'user'], external: true },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [breakAlertOpen, setBreakAlertOpen] = useState(false);
  const [dismissedBreakAlertKey, setDismissedBreakAlertKey] = useState('');
  const { companies, activeCompany, setCompany, isCompanyRestricted } = useCompany();
  const { user } = useAuth();

  const handleLogout = () => appApi.auth.logout('/landing');

  const userRole = ['super_admin', 'admin', 'user'].includes(user?.role) ? user.role : 'user';
  const visibleNavItems = navItems.filter(item => item.roles.includes(userRole) && (!item.agencyOnly || activeCompany?.uses_employee_agency === true));
  const canSeeBreakAlerts = canReceiveBreakTimeAlerts(user);
  const activeCompanyId = activeCompany?.id;
  const timeInReviewBadgeStatus = userRole === 'super_admin' ? 'pending' : 'approved';

  const { data: timeInReviewPage } = useQuery({
    queryKey: ['time-in-reviews', activeCompanyId, 'badge', timeInReviewBadgeStatus],
    queryFn: () => appApi.entities.AttendanceLog.page({
      company_profile_id: activeCompanyId,
      time_in_review_status: timeInReviewBadgeStatus,
    }, '-time_in_review_requested_at', 1, 1),
    enabled: Boolean(activeCompanyId),
    refetchInterval: 30 * 1000,
  });
  const timeInReviewCount = Number(timeInReviewPage?.pagination?.total || 0);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', activeCompanyId, 'break-time-alerts'],
    queryFn: () => appApi.entities.Employee.filter({ status: 'active', company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId && canSeeBreakAlerts,
  });

  const { data: shiftSettings = [] } = useQuery({
    queryKey: ['settings', activeCompanyId, 'break-time-alerts'],
    queryFn: () => appApi.entities.Settings.filter({ company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId && canSeeBreakAlerts,
  });

  const employeesNeedingBreakTime = useMemo(
    () => employeesMissingBreakTime(employees, shiftSettings, manilaDateString()),
    [employees, shiftSettings],
  );
  const missingBreakTimeCount = employeesNeedingBreakTime.length;
  const breakAlertKey = activeCompanyId && missingBreakTimeCount > 0
    ? `break-time-alert:${activeCompanyId}:${employeesNeedingBreakTime.map(employee => employee.id).sort().join(',')}`
    : '';
  const breakAlertStorageKey = activeCompanyId ? `payrollph:break-alert-dismissed:${activeCompanyId}` : '';

  useEffect(() => {
    if (!breakAlertKey || !canSeeBreakAlerts) {
      if (typeof window !== 'undefined' && breakAlertStorageKey) window.localStorage.removeItem(breakAlertStorageKey);
      if (dismissedBreakAlertKey) setDismissedBreakAlertKey('');
      setBreakAlertOpen(false);
      return;
    }
    if (dismissedBreakAlertKey === breakAlertKey) return;
    const storedKey = typeof window !== 'undefined' && breakAlertStorageKey
      ? window.localStorage.getItem(breakAlertStorageKey)
      : '';
    if (storedKey === breakAlertKey) {
      setDismissedBreakAlertKey(breakAlertKey);
      setBreakAlertOpen(false);
      return;
    }
    setBreakAlertOpen(true);
  }, [breakAlertKey, breakAlertStorageKey, canSeeBreakAlerts, dismissedBreakAlertKey]);

  const dismissBreakAlert = () => {
    if (typeof window !== 'undefined' && breakAlertStorageKey && breakAlertKey) {
      window.localStorage.setItem(breakAlertStorageKey, breakAlertKey);
    }
    setDismissedBreakAlertKey(breakAlertKey);
    setBreakAlertOpen(false);
  };

  const SidebarContent = ({ mobile = false } = {}) => {
    const effectiveCollapsed = mobile ? false : collapsed;

    return (
    <div className="flex flex-col h-full">
      <div className={cn("px-4 py-4 border-b border-border", effectiveCollapsed && "px-2")}>
        <div className={cn("flex items-center gap-3", effectiveCollapsed && "justify-center")}>
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-primary-foreground" />
          </div>
          {!effectiveCollapsed && (
            <div>
              <p className="font-semibold text-sm text-foreground">PayrollPH</p>
              <p className="text-xs text-muted-foreground">Philippines Payroll</p>
            </div>
          )}
        </div>
        {!effectiveCollapsed && activeCompany && (
          <div className="mt-3 relative">
            {isCompanyRestricted && companies.length <= 1 ? (
              // Restricted users: just show the company name, no dropdown
              <div className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-primary/10">
                <Building2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span className="text-xs font-semibold text-primary truncate">{activeCompany.company_name}</span>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setCompanyDropdownOpen(!companyDropdownOpen)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span className="text-xs font-semibold text-primary truncate">{activeCompany.company_name}</span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-primary flex-shrink-0" />
                </button>
                {companyDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                    {companies.map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setCompany(c.id); setCompanyDropdownOpen(false); }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors",
                          c.id === activeCompany?.id ? "bg-primary/10 text-primary font-semibold" : "text-foreground"
                        )}
                      >
                        {c.company_name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
	        {visibleNavItems.map((item) => {
            const showBreakBadge = item.path === '/work-schedule' && missingBreakTimeCount > 0;
            const showTimeInReviewBadge = item.path === '/attendance/time-in-reviews' && timeInReviewCount > 0;
            const itemBadgeCount = showTimeInReviewBadge ? timeInReviewCount : missingBreakTimeCount;
            const badgeLabel = itemBadgeCount > 99 ? '99+' : String(itemBadgeCount);

            return (
	          item.external ? (
	            <a
	              key={item.path}
              href={item.path}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMobileOpen(false)}
              className={cn(
	                "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                "text-muted-foreground hover:text-foreground hover:bg-muted border border-dashed border-border mt-2",
                effectiveCollapsed && "justify-center px-2"
              )}
            >
	              <item.icon className="w-4 h-4 flex-shrink-0" />
	              {!effectiveCollapsed && <span>{item.label} ↗</span>}
	            </a>
	          ) : (
	            <NavLink
              key={item.path}
              to={item.path}
              end
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                effectiveCollapsed && "justify-center px-2"
              )}
            >
	              <item.icon className="w-4 h-4 flex-shrink-0" />
	              {!effectiveCollapsed && <span className="flex-1">{item.label}</span>}
                {showBreakBadge && (
                  <Badge
                    variant="destructive"
                    className={cn(
                      "h-5 min-w-5 px-1.5 justify-center rounded-full text-[10px] leading-none",
                      effectiveCollapsed && "absolute -right-1 -top-1"
                    )}
                  >
                    {badgeLabel}
                  </Badge>
                )}
                {showTimeInReviewBadge && (
                  <Badge
                    className={cn(
                      "h-5 min-w-5 justify-center rounded-full bg-amber-500 px-1.5 text-[10px] leading-none text-white hover:bg-amber-500",
                      effectiveCollapsed && "absolute -right-1 -top-1"
                    )}
                  >
                    {badgeLabel}
                  </Badge>
                )}
	            </NavLink>
	          )
          )})}
	      </nav>

      <div className={cn("p-3 border-t border-border", effectiveCollapsed && "px-1")}>
        {user && !effectiveCollapsed && (
          <div className="px-2 py-2 mb-2 rounded-lg bg-muted">
            <p className="text-xs font-medium text-foreground truncate">{user.full_name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className={cn("w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10", effectiveCollapsed && "px-2")}
        >
          <LogOut className="w-4 h-4" />
          {!effectiveCollapsed && <span className="ml-2">Logout</span>}
        </Button>
      </div>
    </div>
    );
  };

  return (
	    <div className="flex h-screen bg-background overflow-hidden">
        <Dialog open={breakAlertOpen} onOpenChange={open => open ? setBreakAlertOpen(true) : dismissBreakAlert()}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <DialogTitle>Break time required</DialogTitle>
                  <DialogDescription>
                    {missingBreakTimeCount} active employee{missingBreakTimeCount === 1 ? ' needs' : 's need'} a lunch break schedule.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="rounded-lg border border-border bg-muted/30 max-h-52 overflow-auto">
              {employeesNeedingBreakTime.slice(0, 8).map(employee => (
                <div key={employee.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{employee.first_name} {employee.last_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{employee.employee_id || 'No employee ID'}{employee.department ? ` · ${employee.department}` : ''}</p>
                  </div>
                  <Badge variant="destructive" className="text-[10px]">Missing</Badge>
                </div>
              ))}
              {employeesNeedingBreakTime.length > 8 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  +{employeesNeedingBreakTime.length - 8} more employee{employeesNeedingBreakTime.length - 8 === 1 ? '' : 's'}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={dismissBreakAlert}>Dismiss</Button>
              <Button asChild onClick={dismissBreakAlert}>
                <NavLink to="/settings">Set break times</NavLink>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

	      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col border-r border-border bg-card transition-all duration-300 flex-shrink-0",
        collapsed ? "w-14" : "w-56"
      )}>
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute left-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%-1px)] z-10 w-5 h-8 bg-card border border-border rounded-r-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          style={{ marginLeft: collapsed ? '3.5rem' : '14rem', transition: 'margin 0.3s' }}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* Mobile Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 max-w-[85vw] bg-card border-r border-border shadow-xl">
            <SidebarContent mobile />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={() => setMobileOpen(true)}
            className="h-10 w-10 -ml-2 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted active:bg-muted"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-sm">PayrollPH</span>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
