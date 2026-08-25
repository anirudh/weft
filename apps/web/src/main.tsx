import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Horizon } from './Horizon.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Horizon />
  </StrictMode>,
);
