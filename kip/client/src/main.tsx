import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ThemeProvider } from './components/theme-provider';

const queryTheme = new URLSearchParams(window.location.search).get('theme');
const urlTheme = queryTheme === 'light' || queryTheme === 'dark' ? queryTheme : undefined;
const isEmbedded = window !== window.parent;
if (!isEmbedded && urlTheme) localStorage.setItem('theme', urlTheme);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} forcedTheme={isEmbedded ? urlTheme : undefined}>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
