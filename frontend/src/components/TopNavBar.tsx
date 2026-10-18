import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, Gauge, Sun, Moon, Map, Wrench, Terminal, Sparkles, FileSpreadsheet, BarChart3, Fuel,
  Tablet, ExternalLink, ChevronDown, LayoutGrid,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { DumpTruckIcon, SemiTruckIcon } from './dashboard/VehicleIcons';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu';

type NavIcon = React.ComponentType<{ className?: string; strokeWidth?: string | number }>;

// Основные разделы — всегда на виду.
const navItems: { id: string; path: string; label: string; icon: NavIcon }[] = [
  { id: 'home',      path: '/',           label: 'ГЛАВНАЯ',     icon: Home },
  { id: 'kip',       path: '/kip',        label: 'КИП ТЕХНИКИ', icon: Gauge },
  { id: 'tractors',  path: '/tyagachi',   label: 'ТЯГАЧИ',      icon: SemiTruckIcon },
  { id: 'dump',      path: '/samosvaly',  label: 'САМОСВАЛЫ',   icon: DumpTruckIcon },
  { id: 'fuel',      path: '/fuel',       label: 'ТОПЛИВО',     icon: Fuel },
  { id: 'analytics', path: '/analytics',  label: 'АНАЛИТИКА',   icon: BarChart3 },
];

// Вспомогательные разделы — в меню «Сервисы».
const serviceItems: { path: string; label: string; icon: NavIcon; external?: boolean }[] = [
  { path: '/reports',        label: 'Отчёты',        icon: FileSpreadsheet },
  { path: '/ai-demo',        label: 'AI-отчёты',     icon: Sparkles },
  { path: '/vehicle-status', label: 'Состояние ТС',  icon: Wrench },
  { path: '/geo-admin',      label: 'Гео-объекты',   icon: Map },
  { path: '/admin',          label: 'Серверы',       icon: Terminal },
];
const externalItem = { href: '/vydacha-topliva/index.html', label: 'Выдача топлива', icon: Tablet };

const itemClass = (active: boolean) =>
  `flex items-center gap-1.5 h-7 px-3 rounded-lg font-medium whitespace-nowrap no-underline border-none cursor-pointer ${
    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground bg-transparent'
  }`;
const itemStyle = (active: boolean): React.CSSProperties => ({
  fontSize: '11px',
  letterSpacing: '0.3px',
  boxShadow: active ? '0 0 20px rgba(249, 115, 22, 0.15)' : 'none',
  transition: 'box-shadow 200ms ease',
  textDecoration: 'none',
});

const TopNavBar: React.FC = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const isDark = resolvedTheme === 'dark';
  const activeService = serviceItems.find(s => pathname === s.path || pathname.startsWith(s.path + '/'));
  const ServiceIcon = activeService?.icon ?? LayoutGrid;

  return (
    <nav className="flex items-center gap-3 px-3 h-10 glass-card shrink-0">
      <Link to="/" className="flex items-center gap-1.5 h-7 whitespace-nowrap no-underline shrink-0" style={{ textDecoration: 'none' }}>
        <span className="text-primary font-bold" style={{ fontSize: '12px' }}>ЛК</span>
        <span className="text-foreground font-semibold tracking-wide" style={{ fontSize: '12px' }}>МОНИТОРИНГ</span>
      </Link>
      <div className="w-px h-5 bg-border shrink-0" />

      <div className="flex items-center gap-1 min-w-0">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = item.path === '/'
            ? pathname === '/'
            : pathname === item.path || pathname.startsWith(item.path + '/');
          return (
            <Link key={item.id} to={item.path} className={itemClass(isActive)} style={itemStyle(isActive)}>
              <Icon className="h-4 w-auto shrink-0" strokeWidth={1.8} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-1 ml-auto shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger className={itemClass(!!activeService)} style={itemStyle(!!activeService)}>
            <ServiceIcon className="h-4 w-auto shrink-0" strokeWidth={1.8} />
            <span>{activeService ? activeService.label.toUpperCase() : 'СЕРВИСЫ'}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {serviceItems.map(s => {
              const Icon = s.icon;
              return (
                <DropdownMenuItem key={s.path} asChild className={activeService === s ? 'bg-muted font-medium' : ''}>
                  <Link to={s.path} className="no-underline" style={{ textDecoration: 'none' }}>
                    <Icon className="size-4" />
                    {s.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={externalItem.href} target="_blank" rel="noreferrer" className="no-underline" style={{ textDecoration: 'none' }}>
                <externalItem.icon className="size-4" />
                {externalItem.label}
                <ExternalLink className="size-3.5 ml-auto" />
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label={isDark ? 'Светлая тема' : 'Тёмная тема'}
          title={isDark ? 'Светлая тема' : 'Тёмная тема'}
          className="flex items-center justify-center size-7 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none"
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </nav>
  );
};

export default TopNavBar;
