import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import TopNavBar from './components/TopNavBar';
import { Dashboard } from './components/dashboard/dashboard';
import { DumpTrucksPage } from './features/samosvaly';
import { TyagachiPage } from './features/tyagachi';
import { VehicleStatusPage } from './features/vehicle-status';
import { AdminPage } from './features/admin';
import { AiReportsPage } from './features/ai-reports';
import { ReportsPage } from './features/reports';
import { AnalyticsPage } from './features/analytics';
import { FuelAdminPage } from './features/fuel';

const KipPage: React.FC = () => {
  const { theme } = useTheme();
  const host = window.location.hostname;
  const isTunnel = host.includes('.devtunnels.ms') || host.includes('.loca.lt') || host.includes('.ngrok') || host.includes('.trycloudflare.com');
  const kipUrl = isTunnel
    ? `${window.location.origin.replace('5173', '3001')}?theme=${theme}`
    : `http://${host}:3001?theme=${theme}`;
  return (
    <div className="flex-1 min-h-0">
      <iframe
        src={kipUrl}
        className="w-full h-full border-0"
        title="КИП техники"
      />
    </div>
  );
};

const GeoAdminPage: React.FC = () => {
  const host = window.location.hostname;
  const isTunnel = host.includes('.devtunnels.ms') || host.includes('.loca.lt') || host.includes('.ngrok') || host.includes('.trycloudflare.com');
  const geoAdminUrl = isTunnel
    ? `${window.location.origin.replace('5173', '3003')}/admin`
    : `http://${host}:3003/admin`;
  return (
    <div className="flex-1 min-h-0">
      <iframe
        src={geoAdminUrl}
        className="w-full h-full border-0"
        title="Гео-Администратор"
      />
    </div>
  );
};

// const MAINTENANCE_NOTICE = 'На сервере ведутся технические работы, актуальные данные недоступны';

const App: React.FC = () => {
  // const location = useLocation();

  // React.useEffect(() => {
  //   const wasShown = sessionStorage.getItem('maintenance_notice_shown') === 'true';
  //   if (!wasShown) {
  //     alert(MAINTENANCE_NOTICE);
  //     sessionStorage.setItem('maintenance_notice_shown', 'true');
  //     return;
  //   }

  //   if (['/', '/kip', '/tyagachi', '/samosvaly'].includes(location.pathname)) {
  //     alert(MAINTENANCE_NOTICE);
  //   }
  // }, [location.pathname]);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--bg-gradient)', position: 'relative' }}
    >
      {/* Ambient halos — global, visible on all pages */}
      <div style={{
        position: 'absolute', top: '-20%', right: '-10%',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(249,115,22,0.04) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', bottom: '-15%', left: '-5%',
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59,130,246,0.03) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      <div className="px-3 pt-3 shrink-0" style={{ position: 'relative', zIndex: 1 }}>
        <TopNavBar />
      </div>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/kip" element={<KipPage />} />
        <Route path="/geo-admin" element={<GeoAdminPage />} />
        <Route path="/tyagachi/*" element={<TyagachiPage />} />
        <Route path="/samosvaly" element={<DumpTrucksPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/vehicle-status" element={<VehicleStatusPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/ai-demo" element={<AiReportsPage />} />
        <Route path="/fuel" element={<FuelAdminPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default App;
