import {useRef, useState, useEffect, useCallback} from 'preact/hooks';

export interface MultiSelectComboboxProps {
    options: string[];
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
    label?: string;
    required?: boolean;
    ariaDescribedBy?: string;
}

export function MultiSelectCombobox({
    options,
    value,
    onChange,
    placeholder = 'Elegí tipos…',
    label,
    required = false,
    ariaDescribedBy,
}: MultiSelectComboboxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(-1);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const id = useRef(`combobox-${Math.random().toString(36).slice(2)}`).current;
    const listId = `${id}-list`;

    const filteredOptions = options.filter(opt =>
        opt.toLowerCase().includes(search.toLowerCase())
    );

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                setActiveIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                setActiveIndex(prev => Math.max(prev - 1, -1));
                break;
            case 'Enter':
            case ' ':
                if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
                    event.preventDefault();
                    const option = filteredOptions[activeIndex];
                    if (option) toggleOption(option);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                setSearch('');
                setActiveIndex(-1);
                buttonRef.current?.focus();
                break;
            case 'Tab':
                setIsOpen(false);
                setSearch('');
                setActiveIndex(-1);
                break;
            case 'Backspace':
                if (!search && value.length > 0) {
                    onChange(value.slice(0, -1));
                    inputRef.current?.focus();
                }
                break;
        }
    }, [activeIndex, filteredOptions, onChange, value]);

    const toggleOption = useCallback((option: string) => {
        const newValue = value.includes(option)
            ? value.filter(v => v !== option)
            : [...value, option];
        onChange(newValue);
    }, [value, onChange]);

    const removeTag = useCallback((option: string) => {
        onChange(value.filter(v => v !== option));
    }, [value, onChange]);

    const handleInputChange = useCallback((event: Event) => {
        const target = event.currentTarget as HTMLInputElement;
        setSearch(target.value);
        setActiveIndex(-1);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!buttonRef.current?.contains(event.target as Node) &&
                !listRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
                setSearch('');
                setActiveIndex(-1);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setActiveIndex(-1);
        }
    }, [isOpen]);

    return (
        <div className="multi-select-combobox">
            {label && <label htmlFor={id}>{label}</label>}
            <button type="button"
                    className="combobox-trigger"
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-required={required}
                    aria-describedby={ariaDescribedBy}
                    aria-label="Tipos de estudio"
                    onClick={() => setIsOpen(!isOpen)}
                    onKeyDown={handleKeyDown}
                    tabIndex={0}
                    ref={buttonRef}
                    id={id}>
                <div className="combobox-tags">
                    {value.map((opt) => (
                        <span key={opt} className="combobox-tag">
                            {opt}
                            <button type="button"
                                    className="combobox-tag-remove"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeTag(opt);
                                    }}
                                    aria-label={`Quitar ${opt}`}>
                                <svg className="icon" aria-hidden="true"><use href="#i-close"/></svg>
                            </button>
                        </span>
                    ))}
                    {value.length === 0 && <span className="combobox-placeholder">{placeholder}</span>}
                </div>
                <svg className="combobox-chevron" aria-hidden="true">
                    <use href="#i-chevron-down"/>
                </svg>
            </button>
            {isOpen && (
                <ul className="combobox-dropdown" role="listbox" id={listId} ref={listRef}>
                    <li className="combobox-search-wrapper">
                        <input type="text"
                               className="combobox-search"
                               placeholder="Filtrar tipos…"
                               value={search}
                               onInput={handleInputChange}
                               onClick={(e) => e.stopPropagation()}
                               ref={inputRef}
                               autoComplete="off"
                               aria-label="Filtrar tipos de estudio"/>
                    </li>
                    {filteredOptions.length === 0 ? (
                        <li className="combobox-empty" role="option" aria-disabled="true">
                            Sin coincidencias
                        </li>
                    ) : (
                        filteredOptions.map((opt, index) => (
                            <li key={opt}
                                role="option"
                                aria-selected={value.includes(opt)}
                                aria-checked={value.includes(opt)}
                                className={`combobox-option ${value.includes(opt) ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`}
                                onClick={() => toggleOption(opt)}
                                onMouseEnter={() => setActiveIndex(index)}>
                                <span>{opt}</span>
                            </li>
                        ))
                    )}
                </ul>
            )}
        </div>
    );
}