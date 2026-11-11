export type ToastType = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  title?: string;
  duration?: number;
}

interface ToastElement extends HTMLDivElement {
  toastId: string;
  hideTimer: ReturnType<typeof setTimeout>;
}

const TOAST_CONTAINER_ID = 'toast-container';

function getContainer(): HTMLDivElement {
  let container = document.getElementById(TOAST_CONTAINER_ID) as HTMLDivElement;
  if (!container) {
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.className = 'toast-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Notificaciones');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(toast: Toast): void {
  const container = getContainer();
  const element = document.createElement('div');
  element.className = ['toast', `toast-${toast.type}`].join(' ');
  element.setAttribute('role', 'alert');
  element.setAttribute('aria-live', 'assertive');

  const iconMap: Record<ToastType, string> = {
    info: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    success: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    error: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  };

  const titleHtml = toast.title ? `<div class="toast-title">${toast.title}</div>` : '';
  element.innerHTML = `
    <div class="toast-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconMap[toast.type]}</svg>
    </div>
    <div class="toast-content">
      ${titleHtml}
      <p class="toast-message">${toast.message}</p>
    </div>
    <button type="button" class="toast-close" aria-label="Cerrar notificación">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6l-12 12"/></svg>
    </button>
  `;

  const closeBtn = element.querySelector('.toast-close')!;
  closeBtn.addEventListener('click', () => hideToast(element));

  container.appendChild(element);

  const duration = toast.duration ?? 4000;
  const timer = setTimeout(() => hideToast(element), duration);
  (element as ToastElement).toastId = toast.id;
  (element as ToastElement).hideTimer = timer;
}

export function hideToast(element: HTMLDivElement): void {
  const el = element as ToastElement;
  clearTimeout(el.hideTimer);
  element.classList.add('toast-leaving');
  setTimeout(() => element.remove(), 200);
}

export function hideAllToasts(): void {
  const container = document.getElementById(TOAST_CONTAINER_ID);
  if (container) {
    for (const child of container.children) {
      hideToast(child as HTMLDivElement);
    }
  }
}
