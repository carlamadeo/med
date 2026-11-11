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
  label?: string;
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
    label: _label,
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

  const classes = ['input', 'select', error ? 'input-error' : '', className].filter(Boolean).join(' ');
  select.className = classes;

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
  const { label, helpText, errorText, id, 'aria-describedby': ariaDescribedBy, ...selectProps } = props;

  const wrapper = document.createElement('div');
  wrapper.className = 'input-group';

  const selectId = id || `select-${crypto.randomUUID()}`;
  const describedBy: string[] = [];

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.htmlFor = selectId;
    labelEl.className = 'label';
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);
  }

  if (helpText) {
    const helpId = `${selectId}-help`;
    const helpEl = document.createElement('p');
    helpEl.id = helpId;
    helpEl.className = 'hint';
    helpEl.textContent = helpText;
    wrapper.appendChild(helpEl);
    describedBy.push(helpId);
  }

  if (errorText) {
    const errorId = `${selectId}-error`;
    const errorEl = document.createElement('p');
    errorEl.id = errorId;
    errorEl.className = 'form-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.textContent = errorText;
    wrapper.appendChild(errorEl);
    describedBy.push(errorId);
    selectProps.error = true;
  }

  const select = createSelect({ ...selectProps, id: selectId });
  if (describedBy.length) {
    const combined = [...(ariaDescribedBy ? [ariaDescribedBy] : []), ...describedBy].join(' ');
    select.setAttribute('aria-describedby', combined);
  }
  wrapper.appendChild(select);

  return wrapper;
}