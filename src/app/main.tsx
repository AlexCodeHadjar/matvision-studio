import { createRoot } from 'react-dom/client';
import { App } from '../ui/App';
import { log } from './log';
const root = document.getElementById('root');
if (!root) throw new Error('Application root element is missing.');
createRoot(root).render(<App />);
log('APP', 'started', { version: '0.1.3' });
