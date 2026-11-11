export type BadgeVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'error';

export interface BadgeProps {
  variant?: BadgeVariant;
  children?: string | Node;
  className?: string;
  removable?: boolean;
  onRemove?: () => void;
}

export function createBadge(props: BadgeProps = {}): HTMLSpanElement {
  const { variant = 'secondary', children, className = '', removable = false, onRemove } = props;

  const badge = document.createElement('span');
  badge.className = ['badge', `badge-${variant}`, className].filter(Boolean).join(' ');

  if (typeof children === 'string') {
    badge.textContent = children;
  } else if (children instanceof Node) {
    badge.appendChild(children);
  }

  if (removable && onRemove) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'badge-remove';
    removeBtn.setAttribute('aria-label', 'Eliminar');
    removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6l-12 12"/></svg>';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    badge.appendChild(removeBtn);
  }

  return badge;
}

export function Badge(props: BadgeProps): HTMLSpanElement {
  return createBadge(props);
}