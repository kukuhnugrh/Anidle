import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { upgradeHashUrl } from './route';
import './styles.css';

upgradeHashUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
