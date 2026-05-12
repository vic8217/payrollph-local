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

    const assignedCompanyIds = currentUser?.role !== 'super_admin'
      ? (Array.isArray(currentUser?.company_profile_ids) && currentUser.company_profile_ids.length
        ? currentUser.company_profile_ids
        : (currentUser?.company_profile_id ? [currentUser.company_profile_id] : []))
      : [];
    const visibleCompanies = assignedCompanyIds.length
      ? list.filter(c => assignedCompanyIds.includes(c.id))
      : list;

    setCompanies(visibleCompanies);

    if (assignedCompanyIds.length) {
      setIsCompanyRestricted(true);
      setActiveCompanyId((currentId) => {
        if (selectCompanyId && visibleCompanies.some(c => c.id === selectCompanyId)) {
          return selectCompanyId;
        }
        if (currentId && visibleCompanies.some(c => c.id === currentId)) {
          return currentId;
        }
        return visibleCompanies[0]?.id || null;
      });
      return visibleCompanies;
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

    return visibleCompanies;
  }, []);

  useEffect(() => {
    refreshCompanies();
  }, [refreshCompanies]);

  const setCompany = (id) => {
    if (companies.some(c => c.id === id)) setActiveCompanyId(id);
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
