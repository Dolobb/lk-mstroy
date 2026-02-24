import React, { useState } from 'react';
import TopNavBar from './components/TopNavBar';
import { Dashboard } from './components/dashboard/dashboard';

const App: React.FC = () => {
  const [activeNav, setActiveNav] = useState('home');

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gradient-to-b from-background via-[var(--background-gradient-mid)] to-[var(--background-gradient-end)]">
      {/* Top navigation */}
      <div className="px-3 pt-3 shrink-0">
        <TopNavBar activeNav={activeNav} onNavChange={setActiveNav} />
      </div>

      {/* Home / Dashboard */}
      {activeNav === 'home' && <Dashboard />}

      {/* КИП техники — iframe */}
      {activeNav === 'kip' && (
        <div className="flex-1 min-h-0">
          <iframe
            src="http://localhost:3001"
            className="w-full h-full border-0"
            title="КИП техники"
          />
        </div>
      )}

      {/* Тягачи — заглушка с кнопкой */}
      {activeNav === 'tractors' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground text-sm">Аналитика тягачей ожидает миграции в общий продукт. Пока что это отдельный сервис</p>
          <a
            href="http://localhost:8000"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Открыть тягачи
          </a>
        </div>
      )}

      {/* Самосвалы — референс v6 */}
      {activeNav === 'dump' && (
        <div className="flex-1 min-h-0">
          <iframe
            src="/samosvaly-v6.html"
            className="w-full h-full border-0"
            title="Самосвалы"
          />
        </div>
      )}
    </div>
  );
};

export default App;
