export interface InputProps {
  type?: 'text' | 'email' | 'password' | 'number' | 'url' | 'search' | 'date';
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  error?: boolean;
  id?: string;
  name?: string;
  autocomplete?: string;
  inputMode?: string;
  maxLength?: number;
  min?: string;
  max?: string;
  onChange?: (value: string, event: Event) => void;
  onInput?: (value: string, event: Event) => void;
  onBlur?: (event: FocusEvent) => void;
  'aria-describedby'?: string;
  'aria-label'?: string;
  className?: string;
}

export function createInput(props: InputProps = {}): HTMLInputElement {
  const {
    type = 'text',
    value = '',
    placeholder = '',
    disabled = false,
    required = false,
    readOnly = false,
    error = false,
    id,
    name,
    autocomplete,
    inputMode,
    maxLength,
    min,
    max,
    onChange,
    onInput,
    onBlur,
    'aria-describedby': ariaDescribedBy,
    'aria-label': ariaLabel,
    className = '',
  } = props;

  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.disabled = disabled;
  input.required = required;
  input.readOnly = readOnly;

  if (id) input.id = id;
  if (name) input.name = name;
  if (autocomplete) input.setAttribute('autocomplete', autocomplete);
  if (inputMode) input.setAttribute('inputmode', inputMode);
  if (maxLength) input.maxLength = maxLength;
  if (min) input.min = min;
  if (max) input.max = max;
  if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
  if (ariaDescribedBy) input.setAttribute('aria-describedby', ariaDescribedBy);

  input.className = ['input', error ? 'input-error' : '', className].filter(Boolean).join(' ');

  if (onChange) input.addEventListener('change', (e) => onChange((e.target as HTMLInputElement).value, e));
  if (onInput) input.addEventListener('input', (e) => onInput((e.target as HTMLInputElement).value, e));
  if (onBlur) input.addEventListener('blur', onBlur);

  return input;
}

export function Input(props: InputProps): HTMLInputElement {
  return createInput(props);
}

export function createInputGroup(props: InputProps & { helpText?: string; errorText?: string } = {}): HTMLDivElement {
  const { helpText, errorText, id, 'aria-describedby': ariaDescribedBy, ...inputProps } = props;

  const wrapper = document.createElement('div');
  wrapper.className = 'input-group';

  const inputId = id || `input-${crypto.randomUUID()}`;
  const describedBy: string[] = [];

  if (helpText) {
    const helpId = `${inputId}-help`;
    const helpEl = document.createElement('p');
    helpEl.id = helpId;
    helpEl.className = 'hint';
    helpEl.textContent = helpText;
    wrapper.appendChild(helpEl);
    describedBy.push(helpId);
  }

  if (errorText) {
    const errorId = `${inputId}-error`;
    const errorEl = document.createElement('p');
    errorEl.id = errorId;
    errorEl.className = 'form-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.textContent = errorText;
    wrapper.appendChild(errorEl);
    describedBy.push(errorId);
    inputProps.error = true;
  }

  const input = createInput({ ...inputProps, id: inputId });
  if (describedBy.length) {
    const combined = [...(ariaDescribedBy ? [ariaDescribedBy] : []), ...describedBy].join(' ');
    input.setAttribute('aria-describedby', combined);
  }
  wrapper.appendChild(input);

  return wrapper;
}