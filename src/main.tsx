import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './workspace.css';
import './guided.css';
import './catalyst-identity.css';
import './foundry.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
