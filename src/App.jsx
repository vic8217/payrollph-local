import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { CompanyProvider } from '@/lib/CompanyContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import Employees from '@/pages/Employees';
import QRScanner from '@/pages/QRScanner';
import Attendance from '@/pages/Attendance';
import Payroll from '@/pages/Payroll';
import PayrollDashboard from '@/pages/PayrollDashboard';
import StatutoryRates from '@/pages/StatutoryRates';
import CashAdvance from '@/pages/CashAdvance';
import PersonalLeave from '@/pages/PersonalLeave';
import Holidays from '@/pages/Holidays';
import ThirteenthMonthPay from '@/pages/ThirteenthMonthPay';
import SeparationPay from '@/pages/SeparationPay';

import EmployeePortal from '@/pages/EmployeePortal';
import NoWorkDays from '@/pages/NoWorkDays';
import ScanConfirm from '@/pages/ScanConfirm';
import PayrollSummary from '@/pages/PayrollSummary';
import PasscodeManager from '@/pages/PasscodeManager';
import CompanyProfile from '@/pages/CompanyProfile';
import ArchivedCompanies from '@/pages/ArchivedCompanies';
import Settings from '@/pages/Settings';
import WorkSchedule from '@/pages/WorkSchedule';
import EmployeePortalQR from '@/pages/EmployeePortalQR';
import UserManagement from '@/pages/UserManagement';
import UsersLog from '@/pages/UsersLog';
import PasscodeAudit from '@/pages/PasscodeAudit';
import Landing from '@/pages/Landing';
import PayslipAcknowledgements from '@/pages/PayslipAcknowledgements';
import SpecialRates from '@/pages/SpecialRates';
import SpecialRatePayroll from '@/pages/SpecialRatePayroll';
import MandatoryDeductions from '@/pages/MandatoryDeductions';
import ManagementReports from '@/pages/ManagementReports';
import PayrollReconciliation from '@/pages/PayrollReconciliation';
import TimeInReviews from '@/pages/TimeInReviews';
import Agency from '@/pages/Agency';
import Maintenance from '@/pages/Maintenance';
import { hasPermission, permissionForPath } from '@/lib/permissions';

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  // Public routes — render immediately without auth check, no loading needed
  const path = window.location.pathname;
  if (path === '/maintenance') {
    return <Maintenance />;
  }
  if (path.startsWith('/employee-portal')) {
    return <EmployeePortal />;
  }
  if (path === '/scan/confirm') {
    return <ScanConfirm />;
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/reset-password" element={<Landing />} />
        <Route path="/scan/confirm" element={<ScanConfirm />} />
        <Route path="/employee-portal-qr" element={<EmployeePortalQR />} />
        <Route path="/employee-portal" element={<EmployeePortal />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Keep client-side navigation aligned with the server request gate. This is
  // especially important for `/`, which remains public so the login page can
  // be reached while maintenance mode is active.
  const requiredPermission = permissionForPath(path);
  if (requiredPermission && !hasPermission(user.role, requiredPermission)) {
    return <Navigate to="/attendance" replace />;
  }

  return (
    <Routes>
      <Route path="/landing" element={<Landing />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/agency" element={<Agency />} />
        <Route path="/scan" element={<QRScanner />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/attendance/time-in-reviews" element={<TimeInReviews />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/payroll/reconciliation" element={<PayrollReconciliation />} />
        <Route path="/management-reports" element={<ManagementReports />} />
        <Route path="/special-rates" element={<SpecialRates />} />
        <Route path="/special-rate-payroll" element={<SpecialRatePayroll />} />
        <Route path="/payroll-dashboard" element={<PayrollDashboard />} />
        <Route path="/thirteenth-month-pay" element={<ThirteenthMonthPay />} />
        <Route path="/separation-pay" element={<SeparationPay />} />
        <Route path="/statutory-rates" element={<StatutoryRates />} />
        <Route path="/mandatory-deductions" element={<MandatoryDeductions />} />
        <Route path="/cash-advance" element={<CashAdvance />} />
        <Route path="/personal-leave" element={<PersonalLeave />} />
        <Route path="/holidays" element={<Holidays />} />
        <Route path="/no-work-days" element={<NoWorkDays />} />
        <Route path="/payroll-summary" element={<PayrollSummary />} />
        <Route path="/passcode-manager" element={<PasscodeManager />} />
        <Route path="/company-profile" element={<CompanyProfile />} />
        <Route path="/archived-companies" element={<ArchivedCompanies />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/work-schedule" element={<WorkSchedule />} />
        <Route path="/user-management" element={<UserManagement />} />
        <Route path="/users-log" element={<UsersLog />} />
        <Route path="/passcode-audit" element={<PasscodeAudit />} />
        <Route path="/payslip-acknowledgements" element={<PayslipAcknowledgements />} />
      </Route>
      <Route path="/scan/confirm" element={<ScanConfirm />} />
      <Route path="/employee-portal-qr" element={<EmployeePortalQR />} />
      <Route path="/employee-portal" element={<EmployeePortal />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <CompanyProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </CompanyProvider>
    </AuthProvider>
  )
}

export default App
