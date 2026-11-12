import './presentation/styles/index.css';
import { render } from 'preact';
import { LibraryPage } from './presentation/pages/LibraryPage';

render(<LibraryPage />, document.getElementById('app')!);
