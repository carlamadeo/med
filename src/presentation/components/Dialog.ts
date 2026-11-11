export interface DialogProps {
  id: string;
  title: string;
  description?: string;
  children?: Node | Node[];
  open?: boolean;
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export function createDialog(props: DialogProps): HTMLDialogElement {
  const {
    id,
    title,
    description,
    children,
    onClose,
    size = 'md',
    closeOnOverlayClick = true,
    closeOnEscape = true,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
  } = props;

  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = ['dialog', `dialog-${size}`].filter(Boolean).join(' ');

  if (ariaLabelledBy) dialog.setAttribute('aria-labelledby', ariaLabelledBy);
  if (ariaDescribedBy) dialog.setAttribute('aria-describedby', ariaDescribedBy);

  const headerId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;

  dialog.innerHTML = `
    <div class="dialog-header">
      <div>
        <h2 id="${headerId}" class="dialog-title">${title}</h2>
        ${description ? `<p id="${descId}" class="dialog-description">${description}</p>` : ''}
      </div>
      <button type="button" class="dialog-close" aria-label="Cerrar" data-close>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6l-12 12"/></svg>
      </button>
    </div>
    <div class="dialog-body"></div>
  `;

  const body = dialog.querySelector('.dialog-body')!;
  if (children) {
    if (Array.isArray(children)) body.append(...children);
    else body.appendChild(children);
  }

  const closeBtn = dialog.querySelector('[data-close]')!;
  closeBtn.addEventListener('click', () => {
    dialog.close();
    onClose?.();
  });

  if (closeOnOverlayClick) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.close();
        onClose?.();
      }
    });
  }

  if (closeOnEscape) {
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !dialog.hasAttribute('data-busy')) {
        dialog.close();
        onClose?.();
      }
    });
  }

  dialog.addEventListener('close', () => {
    onClose?.();
  });

  return dialog;
}

export function Dialog(props: DialogProps): HTMLDialogElement {
  return createDialog(props);
}

export function showDialog(dialog: HTMLDialogElement): void {
  if (!dialog.open) dialog.showModal();
}

export function hideDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}

export function setDialogBusy(dialog: HTMLDialogElement, busy: boolean): void {
  if (busy) dialog.setAttribute('data-busy', 'true');
  else dialog.removeAttribute('data-busy');
}