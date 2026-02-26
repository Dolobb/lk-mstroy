import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ThemeProvider } from './components/theme-provider';

const urlTheme = new URLSearchParams(window.location.search).get('theme') ?? undefined;

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} forcedTheme={urlTheme}>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
