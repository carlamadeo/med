import { createIcon } from './Icon';
import type { ICONS } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';
export type IconName = keyof typeof ICONS;

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (event: MouseEvent) => void;
  children?: string | Node;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export function createButton(props: ButtonProps = {}): HTMLButtonElement {
  const {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    icon,
    iconPosition = 'left',
    fullWidth = false,
    type = 'button',
    onClick,
    children,
    className = '',
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
  } = props;

  const button = document.createElement('button');
  button.type = type;
  button.disabled = disabled || loading;

  const classes = [
    'btn',
    `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    fullWidth ? 'w-full' : '',
    className,
  ].filter(Boolean).join(' ');

  button.className = classes;

  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  if (ariaDescribedBy) button.setAttribute('aria-describedby', ariaDescribedBy);

  if (loading) {
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span class="sr-only">Cargando...</span>`;
  } else {
    const content: Node[] = [];
    if (icon && iconPosition === 'left') {
      content.push(createIcon(icon, size === 'sm' ? 14 : size === 'lg' ? 20 : 18));
    }
    if (typeof children === 'string') {
      content.push(document.createTextNode(children));
    } else if (children instanceof Node) {
      content.push(children);
    }
    if (icon && iconPosition === 'right') {
      content.push(createIcon(icon, size === 'sm' ? 14 : size === 'lg' ? 20 : 18));
    }
    button.append(...content);
  }

  if (onClick) {
    button.addEventListener('click', onClick);
  }

  return button;
}

export function Button(props: ButtonProps): HTMLButtonElement {
  return createButton(props);
}