import { createInputGroup } from './InputGroup';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  id?: string;
  name?: string;
  onChange?: (value: string, event: Event) => void;
  'aria-describedby'?: string;
  'aria-label'?: string;
  className?: string;
}

export function createSelect(props: SelectProps): HTMLSelectElement {
  const {
    options,
    value = '',
    placeholder,
    disabled = false,
    required = false,
    error = false,
    id,
    name,
    onChange,
    'aria-describedby': ariaDescribedBy,
    'aria-label': ariaLabel,
    className = '',
  } = props;

  const select = document.createElement('select');
  select.disabled = disabled;
  select.required = required;
  select.value = value;

  if (id) select.id = id;
  if (name) select.name = name;
  if (ariaLabel) select.setAttribute('aria-label', ariaLabel);
  if (ariaDescribedBy) select.setAttribute('aria-describedby', ariaDescribedBy);

  select.className = ['input', 'select', error ? 'input-error' : '', className].filter(Boolean).join(' ');

  if (placeholder) {
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    placeholderOption.disabled = true;
    placeholderOption.hidden = true;
    select.appendChild(placeholderOption);
  }

  for (const option of options) {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    optionEl.disabled = option.disabled ?? false;
    select.appendChild(optionEl);
  }

  if (onChange) {
    select.addEventListener('change', (e) => onChange((e.target as HTMLSelectElement).value, e));
  }

  return select;
}

export function Select(props: SelectProps): HTMLSelectElement {
  return createSelect(props);
}

export function createSelectGroup(props: SelectProps & { helpText?: string; errorText?: string } = { options: [] }): HTMLDivElement {
  return createInputGroup(props, createSelect, 'select');
}