import { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { appApi } from '@/lib/appApi';

const CompanyContext = createContext();

export const CompanyProvider = ({ children }) => {
  const [companies, setCompanies] = useState([]);
  const [activeCompanyId, setActiveCompanyId] = useState(null);
  const [isCompanyRestricted, setIsCompanyRestricted] = useState(false);

  const refreshCompanies = useCallback(async ({ selectCompanyId } = {}) => {
    const [list, currentUser] = await Promise.all([
      appApi.entities.CompanyProfile.list(),
      appApi.auth.me().catch(() => null),
    ]);

    setCompanies(list);

    // If user has an assigned company and is not super_admin, restrict to that company
    if (currentUser && currentUser.role !== 'super_admin' && currentUser.company_profile_id) {
      const assigned = list.find(c => c.id === currentUser.company_profile_id);
      if (assigned) {
        setActiveCompanyId(assigned.id);
        setIsCompanyRestricted(true);
        return list;
      }
    }

    setIsCompanyRestricted(false);

    setActiveCompanyId((currentId) => {
      if (selectCompanyId && list.some(c => c.id === selectCompanyId)) {
        return selectCompanyId;
      }

      if (currentId && list.some(c => c.id === currentId)) {
        return currentId;
      }

      // Otherwise derive active company from subdomain
      const subdomain = window.location.hostname.split('.')[0];
      const matchBySubdomain = list.find(c => c.subdomain === subdomain);

      if (matchBySubdomain) {
        return matchBySubdomain.id;
      }

      return list[0]?.id || null;
    });

    return list;
  }, []);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const setCompany = (id) => {
    if (!isCompanyRestricted) setActiveCompanyId(id);
  };

  const activeCompany = companies.find(c => c.id === activeCompanyId) || null;

  return (
    <CompanyContext.Provider value={{ companies, activeCompanyId, activeCompany, setCompany, refreshCompanies, isCompanyRestricted }}>
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
};
