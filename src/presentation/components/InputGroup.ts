export interface GroupProps {
    id?: string;
    'aria-describedby'?: string;
    helpText?: string;
    errorText?: string;
}

export function createInputGroup<T extends GroupProps>(
    props: T,
    createElement: (props: T) => HTMLElement,
    elementType: 'input' | 'select'
): HTMLDivElement {
    const {helpText, errorText, id, 'aria-describedby': ariaDescribedBy, ...elementProps} = props;

    const wrapper = document.createElement('div');
    wrapper.className = 'input-group';

    const elementId = id || `${elementType}-${crypto.randomUUID()}`;
    const describedBy: string[] = [];

    if (helpText) {
        const helpId = `${elementId}-help`;
        const helpEl = document.createElement('p');
        helpEl.id = helpId;
        helpEl.className = 'hint';
        helpEl.textContent = helpText;
        wrapper.appendChild(helpEl);
        describedBy.push(helpId);
    }

    if (errorText) {
        const errorId = `${elementId}-error`;
        const errorEl = document.createElement('p');
        errorEl.id = errorId;
        errorEl.className = 'form-error';
        errorEl.setAttribute('role', 'alert');
        errorEl.textContent = errorText;
        wrapper.appendChild(errorEl);
        describedBy.push(errorId);
        (elementProps as Record<string, unknown>).error = true;
    }

    const element = createElement({...elementProps, id: elementId} as T);
    if (describedBy.length) {
        const combined = [...(ariaDescribedBy ? [ariaDescribedBy] : []), ...describedBy].join(' ');
        element.setAttribute('aria-describedby', combined);
    }
    wrapper.appendChild(element);

    return wrapper;
}