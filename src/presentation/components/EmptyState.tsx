import type {ComponentChildren} from 'preact';

export type EmptyStateVariant = 'no-studies' | 'no-results' | 'no-connection' | 'error';

interface EmptyStateProps {
    variant: EmptyStateVariant;
    title: string;
    description: string;
    action?: ComponentChildren;
}

export function EmptyState({variant, title, description, action}: EmptyStateProps) {
    const iconId = variant === 'error'
        ? '#i-alert'
        : variant === 'no-connection'
            ? '#i-wifi-off'
            : variant === 'no-results'
                ? '#i-search'
                : '#i-plus';

    return (
        <div id={variant === 'no-studies' ? 'empty' : `empty-${variant}`} className={`empty empty-${variant}`}
             role="status">
            <div className="empty-icon" aria-hidden="true">
                <svg className="icon" aria-hidden="true">
                    <use href={iconId}/>
                </svg>
            </div>
            <h3>{title}</h3>
            <p>{description}</p>
            {action}
        </div>
    );
}
