// src/business/BusinessContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { getUserBusiness, getBusiness, getSettings, updateSetting, updateBusiness } from '../services/businessService.js';

const BusinessContext = createContext(null);

export function BusinessProvider({ children }) {
  const { user } = useAuth();
  const [business,  setBusiness]  = useState(null);
  const [settings,  setSettings]  = useState(null);
  const [bizLoaded, setBizLoaded] = useState(false);
  const [bizId,     setBizId]     = useState(null);

  const load = useCallback(async (uid) => {
    try {
      const bId  = await getUserBusiness(uid);
      if (!bId) { setBizLoaded(true); return; }
      setBizId(bId);
      const [biz, sett] = await Promise.all([getBusiness(bId), getSettings(bId)]);
      setBusiness(biz);
      setSettings(sett);
    } catch (e) {
      console.error('Business load error:', e);
    } finally {
      setBizLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (user) {
      setBizLoaded(false);
      load(user.uid);
    } else {
      setBusiness(null); setSettings(null); setBizId(null); setBizLoaded(true);
    }
  }, [user, load]);

  const refreshSettings = useCallback(async () => {
    if (!bizId) return;
    const sett = await getSettings(bizId);
    setSettings(sett);
  }, [bizId]);

  const saveSetting = useCallback(async (name, data) => {
    if (!bizId) return;
    await updateSetting(bizId, name, data);
    await refreshSettings();
  }, [bizId, refreshSettings]);

  const saveBusiness = useCallback(async (data) => {
    if (!bizId) return;
    await updateBusiness(bizId, data);
    const biz = await getBusiness(bizId);
    setBusiness(biz);
  }, [bizId]);

  // Convenience getters
  const branding      = settings?.branding       || {};
  const profile       = settings?.businessProfile || {};
  const bizModel      = settings?.businessModel   || {};
  const travelPricing = settings?.travelPricing   || {};
  const payoutConfig  = settings?.payoutConfig    || {};
  const subscription  = settings?.subscription    || {};
  const modelType     = bizModel.modelType || business?.modelType || 'tire_service';
  const brandColor    = branding.brandColor || '#ea580c';

  return (
    <BusinessContext.Provider value={{
      business, settings, bizId, bizLoaded, modelType, brandColor,
      branding, profile, bizModel, travelPricing, payoutConfig, subscription,
      saveSetting, saveBusiness, refreshSettings, setBusiness, setSettings,
    }}>
      {children}
    </BusinessContext.Provider>
  );
}

export const useBusiness = () => useContext(BusinessContext);
