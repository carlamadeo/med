import {useRef, useState, useEffect, useCallback} from 'preact/hooks';

export interface MultiSelectComboboxProps {
    options: string[];
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    label?: string;
    ariaLabel?: string;
    optionCounts?: Record<string, number>;
    required?: boolean;
    allowCreate?: boolean;
    ariaDescribedBy?: string;
}

export function MultiSelectCombobox({
                                        options,
                                        value,
                                        onChange,
                                        placeholder = 'Elegí tipos…',
                                        searchPlaceholder = 'Filtrar o escribir un tipo nuevo…',
                                        label,
                                        ariaLabel = 'Tipos de estudio',
                                        optionCounts,
                                        required = false,
                                        allowCreate = false,
                                        ariaDescribedBy,
                                    }: MultiSelectComboboxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(-1);
    const buttonRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const id = useRef(`combobox-${Math.random().toString(36).slice(2)}`).current;
    const labelId = `${id}-label`;
    const listId = `${id}-list`;

    const trimmedSearch = search.trim().replace(/\s+/g, ' ');
    const normalizedSearch = trimmedSearch.toLocaleLowerCase('es');
    const filteredOptions = options.filter(opt =>
        opt.toLocaleLowerCase('es').includes(normalizedSearch)
    );
    const hasExactMatch = trimmedSearch !== '' && (
        options.some(opt => opt.toLocaleLowerCase('es') === normalizedSearch) ||
        value.some(opt => opt.toLocaleLowerCase('es') === normalizedSearch)
    );
    const canCreate = allowCreate && trimmedSearch !== '' && !hasExactMatch;

    const toggleOption = useCallback((option: string) => {
        const newValue = value.includes(option)
            ? value.filter(v => v !== option)
            : [...value, option];
        onChange(newValue);
    }, [value, onChange]);

    const createOption = useCallback((custom: string) => {
        if (!custom) return;
        if (!value.some(v => v.toLocaleLowerCase('es') === custom.toLocaleLowerCase('es'))) {
            onChange([...value, custom]);
        }
        setSearch('');
        setActiveIndex(-1);
    }, [onChange, value]);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (!isOpen) setIsOpen(true);
                setActiveIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                setActiveIndex(prev => Math.max(prev - 1, -1));
                break;
            case 'Enter':
            case ' ':
                if (!isOpen) {
                    event.preventDefault();
                    setIsOpen(true);
                } else if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
                    event.preventDefault();
                    const option = filteredOptions[activeIndex];
                    if (option) toggleOption(option);
                }
                break;
            case 'Escape':
                if (!isOpen) break;
                event.preventDefault();
                event.stopPropagation();
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
    }, [activeIndex, filteredOptions, isOpen, onChange, search, toggleOption, value]);

    const removeTag = useCallback((option: string) => {
        onChange(value.filter(v => v !== option));
    }, [value, onChange]);

    const handleSearchKeyDown = useCallback((event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(prev => Math.max(prev - 1, -1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
                const option = filteredOptions[activeIndex];
                if (option) toggleOption(option);
            } else if (canCreate) {
                createOption(trimmedSearch);
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
            setSearch('');
            setActiveIndex(-1);
            buttonRef.current?.focus();
        }
    }, [activeIndex, canCreate, createOption, filteredOptions, toggleOption, trimmedSearch]);

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
            {label && (
                <label id={labelId} onClick={() => buttonRef.current?.focus()}>
                    {label}
                </label>
            )}
            <div className="combobox-trigger"
                 role="combobox"
                 aria-expanded={isOpen}
                 aria-controls={listId}
                 aria-autocomplete="list"
                 aria-required={required}
                 aria-describedby={ariaDescribedBy}
                 aria-labelledby={label ? labelId : undefined}
                 aria-label={label ? undefined : ariaLabel}
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
                                    onKeyDown={(e) => e.stopPropagation()}
                                    aria-label={`Quitar ${opt}`}>
                                <svg className="icon" aria-hidden="true"><use href="#i-close"/></svg>
                            </button>
                        </span>
                    ))}
                    {value.length === 0 && <span className="combobox-placeholder">{placeholder}</span>}
                </div>
                <svg className="icon combobox-chevron" aria-hidden="true">
                    <use href="#i-chevron-down"/>
                </svg>
            </div>
            {isOpen && (
                <ul className="combobox-dropdown" role="listbox" id={listId} ref={listRef}>
                    <li className="combobox-search-wrapper">
                        <input type="text"
                               className="combobox-search"
                               placeholder={searchPlaceholder}
                               value={search}
                               onInput={handleInputChange}
                               onKeyDown={handleSearchKeyDown}
                               onClick={(e) => e.stopPropagation()}
                               ref={inputRef}
                               autoComplete="off"
                               aria-label="Filtrar o agregar tipo de estudio"/>
                    </li>
                    {filteredOptions.length === 0 && !canCreate ? (
                        <li className="combobox-empty" role="option" aria-disabled="true">
                            Sin coincidencias
                        </li>
                    ) : (
                        <>
                            {filteredOptions.map((opt, index) => (
                                <li key={opt}
                                    role="option"
                                    aria-selected={value.includes(opt)}
                                    aria-checked={value.includes(opt)}
                                    className={`combobox-option ${value.includes(opt) ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`}
                                    onClick={() => toggleOption(opt)}
                                    onMouseEnter={() => setActiveIndex(index)}>
                                    <span>{opt}</span>
                                    {optionCounts && optionCounts[opt] !== undefined && (
                                        <span className="combobox-option-count">{optionCounts[opt]}</span>
                                    )}
                                </li>
                            ))}
                            {canCreate && (
                                <li role="option"
                                    aria-selected={false}
                                    className="combobox-option combobox-create"
                                    onClick={() => createOption(trimmedSearch)}>
                                    <span>+ Agregar «{trimmedSearch}»</span>
                                </li>
                            )}
                        </>
                    )}
                </ul>
            )}
        </div>
    );
}
