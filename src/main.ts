import './presentation/styles/index.css';
import { registerIcons } from './presentation/components/Icon';
import { App } from './presentation/App';

registerIcons();

const app = new App();
app.mount();