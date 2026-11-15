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
            <svg className="icon theme-icon-light" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
            <svg className="icon theme-icon-dark" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
        </button>
    );
}
