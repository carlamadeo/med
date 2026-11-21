import {useEffect, useRef, useState} from 'preact/hooks';
import {normalize} from '@domain/utils';

let nextAutocompleteId = 0;

export interface AutocompleteOption {
    value: string;
    hint?: string;
}

interface AutocompleteTextFieldProps {
    id?: string;
    name: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    onSelect?: (option: AutocompleteOption) => void;
    options: readonly (string | AutocompleteOption)[];
    placeholder: string;
    listId: string;
    maxLength?: number;
    disabled?: boolean;
    required?: boolean;
    optional?: boolean;
    className?: string;
    autoComplete?: string;
    ariaDescribedBy?: string;
}

export function AutocompleteTextField({
    id,
    name,
    label,
    value,
    onChange,
    onSelect,
    options,
    placeholder,
    listId,
    maxLength = 120,
    disabled = false,
    required = false,
    optional = true,
    className,
    autoComplete = 'off',
    ariaDescribedBy,
}: AutocompleteTextFieldProps) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [fallbackId] = useState(() => `autocomplete-${++nextAutocompleteId}`);
    const inputId = id ?? fallbackId;
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const suppressFocusRef = useRef(false);

    useEffect(() => {
        const handleOutside = (e: Event) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
                setActiveIndex(-1);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('focusin', handleOutside);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('focusin', handleOutside);
        };
    }, []);

    const normalizedOptions: AutocompleteOption[] = options.map((option) =>
        typeof option === 'string' ? {value: option} : option,
    );
    const query = normalize(value);
    const filtered = query
        ? normalizedOptions.filter((option) => normalize(option.value).includes(query))
        : normalizedOptions;

    useEffect(() => {
        setActiveIndex(-1);
    }, [query, open]);

    const selectOption = (option: AutocompleteOption) => {
        onChange(option.value);
        onSelect?.(option);
        setOpen(false);
        setActiveIndex(-1);
        const input = inputRef.current;
        if (input && document.activeElement !== input) {
            suppressFocusRef.current = true;
            input.focus();
        }
    };

    return (
        <div className={className ? `portal-field ${className}` : 'portal-field'} ref={containerRef}>
            <label htmlFor={inputId} className="field-label-wrap">
                <span className="field-label">
                    {label} {optional && <small aria-hidden="true">Opcional</small>}
                </span>
            </label>
            <input
                ref={inputRef}
                id={inputId}
                name={name}
                value={value}
                onInput={(e: Event) => {
                    onChange((e.currentTarget as HTMLInputElement).value);
                    setOpen(true);
                }}
                onFocus={() => {
                    if (suppressFocusRef.current) {
                        suppressFocusRef.current = false;
                        return;
                    }
                    if (!disabled && normalizedOptions.length > 0) setOpen(true);
                }}
                onClick={() => {
                    if (!disabled && normalizedOptions.length > 0) setOpen(true);
                }}
                onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === 'ArrowDown' && filtered.length > 0) {
                        e.preventDefault();
                        if (!open) {
                            setOpen(true);
                            setActiveIndex(0);
                        } else {
                            setActiveIndex((prev) => (prev + 1) % filtered.length);
                        }
                    } else if (e.key === 'ArrowUp' && open && filtered.length > 0) {
                        e.preventDefault();
                        setActiveIndex((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
                    } else if (e.key === 'Enter' && !e.isComposing && open && activeIndex >= 0) {
                        const selected = filtered[activeIndex];
                        if (selected) {
                            e.preventDefault();
                            selectOption(selected);
                        }
                    } else if (e.key === 'Escape' && open) {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpen(false);
                        setActiveIndex(-1);
                    } else if (e.key === 'Tab') {
                        setOpen(false);
                        setActiveIndex(-1);
                    }
                }}
                maxLength={maxLength}
                placeholder={placeholder}
                autoComplete={autoComplete}
                disabled={disabled}
                required={required}
                aria-describedby={ariaDescribedBy}
            />
            {open && !disabled && filtered.length > 0 && (
                <ul id={listId} className="portal-autocomplete-dropdown" role="listbox" aria-label={`Sugerencias de ${label}`}>
                    {filtered.map((option, index) => (
                        <li key={option.value} role="option" aria-selected={index === activeIndex}>
                            <button
                                type="button"
                                className={
                                    index === activeIndex
                                        ? 'portal-autocomplete-item is-active'
                                        : 'portal-autocomplete-item'
                                }
                                // Safari can blur the input before the option receives the click.
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectOption(option)}
                            >
                                <span>{option.value}</span>
                                {option.hint && <small className="portal-autocomplete-hint">{option.hint}</small>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
