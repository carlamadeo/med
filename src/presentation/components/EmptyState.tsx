import type { ComponentChildren } from 'preact';

export type EmptyStateVariant = 'no-studies' | 'no-results' | 'no-connection' | 'error';

interface EmptyStateProps {
  variant: EmptyStateVariant;
  title: string;
  description: string;
  action?: ComponentChildren;
}

export function EmptyState({ variant, title, description, action }: EmptyStateProps) {
  return (
    <div id={variant === 'no-studies' ? 'empty' : `empty-${variant}`} className={`empty empty-${variant}`} role="status">
      <div className="empty-icon" aria-hidden="true">
        <span>{variant === 'error' ? '!' : variant === 'no-connection' ? '↗' : variant === 'no-results' ? '⌕' : '+'}</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
