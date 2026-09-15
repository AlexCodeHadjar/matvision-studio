import { createRoot } from 'react-dom/client';
import { App } from '../ui/App';
const root = document.getElementById('root');
if (!root) throw new Error('Application root element is missing.');
createRoot(root).render(<App />);
