import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initCapacitor } from './app/services/capacitor-init';
import './styles/index.css';
import App from './App';

initCapacitor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
