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

const App: React.FC = () => {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gradient-to-b from-background via-[var(--background-gradient-mid)] to-[var(--background-gradient-end)]">
      <div className="px-3 pt-3 shrink-0">
        <TopNavBar />
      </div>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/kip" element={<KipPage />} />
        <Route path="/tyagachi/*" element={<TyagachiPage />} />
        <Route path="/samosvaly" element={<DumpTrucksPage />} />
        <Route path="/vehicle-status" element={<VehicleStatusPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/ai-demo" element={<AiReportsPage />} />
        <Route path="/admin" element={
          ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
            ? <AdminPage />
            : <Navigate to="/" replace />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default App;
