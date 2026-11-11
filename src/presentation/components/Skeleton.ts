export interface SkeletonProps {
  variant?: 'text' | 'card' | 'avatar' | 'button' | 'input';
  width?: string | number;
  height?: string | number;
  lines?: number;
  className?: string;
}

export function createSkeleton(props: SkeletonProps = {}): HTMLDivElement {
  const { variant = 'text', width = '100%', height, lines = 1, className = '' } = props;

  const skeleton = document.createElement('div');
  skeleton.className = ['skeleton', className].filter(Boolean).join(' ');
  skeleton.style.width = typeof width === 'number' ? `${width}px` : width;

  if (variant === 'text') {
    skeleton.style.height = height ? (typeof height === 'number' ? `${height}px` : height) : '1rem';
    if (lines > 1) {
      skeleton.style.display = 'flex';
      skeleton.style.flexDirection = 'column';
      skeleton.style.gap = '0.5rem';
      for (let i = 0; i < lines; i++) {
        const line = document.createElement('div');
        line.className = 'skeleton';
        line.style.height = '1rem';
        line.style.width = i === lines - 1 ? '60%' : '100%';
        skeleton.appendChild(line);
      }
    }
  } else if (variant === 'card') {
    skeleton.style.height = height ? (typeof height === 'number' ? `${height}px` : height) : '12rem';
    skeleton.style.borderRadius = 'var(--radius-lg)';
  } else if (variant === 'avatar') {
    const size = height || width || '3rem';
    skeleton.style.width = typeof size === 'number' ? `${size}px` : size;
    skeleton.style.height = typeof size === 'number' ? `${size}px` : size;
    skeleton.style.borderRadius = 'var(--radius-full)';
  } else if (variant === 'button') {
    skeleton.style.height = height ? (typeof height === 'number' ? `${height}px` : height) : '2.5rem';
    skeleton.style.borderRadius = 'var(--radius-md)';
  } else if (variant === 'input') {
    skeleton.style.height = height ? (typeof height === 'number' ? `${height}px` : height) : '2.5rem';
    skeleton.style.borderRadius = 'var(--radius-md)';
  }

  return skeleton;
}

export function Skeleton(props: SkeletonProps): HTMLDivElement {
  return createSkeleton(props);
}

export function createStudyCardSkeleton(): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'record skeleton-card';

  li.innerHTML = `
    <div class="record-main">
      <div class="skeleton skeleton-icon"></div>
      <div class="record-text">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-subtitle"></div>
      </div>
      <div class="type-badges">
        <div class="skeleton skeleton-badge"></div>
        <div class="skeleton skeleton-badge skeleton-badge-short"></div>
      </div>
    </div>
    <div class="record-controls">
      <div class="record-links">
        <div class="skeleton skeleton-link"></div>
      </div>
      <div class="record-actions">
        <div class="skeleton skeleton-action"></div>
        <div class="skeleton skeleton-action"></div>
      </div>
    </div>
  `;

  return li;
}

export function createEmptyStateSkeleton(): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <div class="skeleton skeleton-empty-icon"></div>
    <div class="skeleton skeleton-empty-title"></div>
    <div class="skeleton skeleton-empty-copy"></div>
    <div class="skeleton skeleton-empty-button"></div>
  `;
  return div;
}