import React from 'react';
import { Home, Monitor, Truck, Tractor, Sun, Moon, Map } from 'lucide-react';
import { useTheme } from 'next-themes';

const navItems = [
  { id: 'home', label: 'ГЛАВНАЯ', icon: Home },
  { id: 'kip', label: 'КИП ТЕХНИКИ', icon: Monitor },
  { id: 'tractors', label: 'ТЯГАЧИ', icon: Tractor },
  { id: 'dump', label: 'САМОСВАЛЫ', icon: Truck },
];

interface Props {
  activeNav: string;
  onNavChange: (id: string) => void;
}

const TopNavBar: React.FC<Props> = ({ activeNav, onNavChange }) => {
  const { theme, setTheme } = useTheme();

  return (
    <nav className="flex items-center justify-between px-3 h-10 glass-card shrink-0">
      <div className="flex items-center gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavChange(item.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all cursor-pointer border-none ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground bg-transparent'
              }`}
              style={{
                fontSize: '11px',
                boxShadow: isActive ? '0 0 20px rgba(249, 115, 22, 0.15)' : 'none',
                transition: 'box-shadow 200ms ease',
              }}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <a
          href="http://localhost:3003/admin"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-7 px-2 rounded-md transition-colors border-none"
          style={{ fontSize: '11px', textDecoration: 'none' }}
        >
          <Map className="size-3.5" />
          <span>Гео</span>
        </a>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-7 px-2 rounded-md transition-colors cursor-pointer bg-transparent border-none"
        >
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          <span style={{ fontSize: '11px' }}>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-primary font-bold" style={{ fontSize: '12px' }}>НПС</span>
          <span className="text-muted-foreground" style={{ fontSize: '11px' }}>/</span>
          <span className="text-foreground font-semibold tracking-wide" style={{ fontSize: '12px' }}>
            МОСТОСТРОЙ-11
          </span>
        </div>
      </div>
    </nav>
  );
};

export default TopNavBar;
