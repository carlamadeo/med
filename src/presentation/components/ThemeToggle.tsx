import {useEffect, useState} from 'preact/hooks';

const STORAGE_KEY = 'mis-estudios-theme';
type Theme = 'light' | 'dark';

function systemTheme(): Theme {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        return saved === 'dark' || saved === 'light' ? saved : systemTheme();
    });

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        window.localStorage.setItem(STORAGE_KEY, theme);
    }, [theme]);

    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    return (
        <button
            className="button quiet theme-toggle"
            type="button"
            aria-label={`Cambiar a modo ${nextTheme === 'dark' ? 'oscuro' : 'claro'}`}
            title={`Modo ${nextTheme === 'dark' ? 'oscuro' : 'claro'}`}
            onClick={() => setTheme(nextTheme)}
        >
            <span className="theme-icon-light" aria-hidden="true">☀</span>
            <span className="theme-icon-dark" aria-hidden="true">☾</span>
        </button>
    );
}
