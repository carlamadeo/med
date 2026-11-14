import './presentation/styles/index.css';
import {render} from 'preact';
import {LibraryPage} from '@presentation/pages/LibraryPage';

render(<LibraryPage/>, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        void navigator.serviceWorker.register(new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI)).catch(() => {
            // The application remains usable online when service worker registration is unavailable.
        });
    });
}
