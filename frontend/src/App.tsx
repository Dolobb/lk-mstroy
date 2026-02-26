import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import TopNavBar from './components/TopNavBar';
import { Dashboard } from './components/dashboard/dashboard';
import { DumpTrucksPage } from './features/samosvaly';
import { TyagachiPage } from './features/tyagachi';

const KipPage: React.FC = () => {
  const { theme } = useTheme();
  return (
    <div className="flex-1 min-h-0">
      <iframe
        src={`http://localhost:3001?theme=${theme}`}
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default App;
