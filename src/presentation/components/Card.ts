export interface CardProps {
  children?: Node | Node[];
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export function createCard(props: CardProps = {}): HTMLDivElement {
  const { children, className = '', onClick, hoverable = false } = props;

  const card = document.createElement('div');
  card.className = ['card', hoverable ? 'card-hoverable' : '', className].filter(Boolean).join(' ');

  if (children) {
    if (Array.isArray(children)) {
      card.append(...children);
    } else {
      card.appendChild(children);
    }
  }

  if (onClick) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', onClick);
  }

  return card;
}

export function Card(props: CardProps): HTMLDivElement {
  return createCard(props);
}

export function createCardHeader(children: Node | Node[], className = ''): HTMLDivElement {
  const header = document.createElement('div');
  header.className = ['card-header', className].filter(Boolean).join(' ');
  if (Array.isArray(children)) header.append(...children);
  else if (children) header.appendChild(children);
  return header;
}

export function createCardBody(children: Node | Node[], className = ''): HTMLDivElement {
  const body = document.createElement('div');
  body.className = ['card-body', className].filter(Boolean).join(' ');
  if (Array.isArray(children)) body.append(...children);
  else if (children) body.appendChild(children);
  return body;
}

export function createCardFooter(children: Node | Node[], className = ''): HTMLDivElement {
  const footer = document.createElement('div');
  footer.className = ['card-footer', className].filter(Boolean).join(' ');
  if (Array.isArray(children)) footer.append(...children);
  else if (children) footer.appendChild(children);
  return footer;
}