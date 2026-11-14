/** Small DOM helpers. Text is always set with textContent, never as HTML. */
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(text: string, className = 'btn', title?: string): HTMLButtonElement {
  const node = make('button', className, text);
  node.type = 'button';
  if (title) node.title = title;
  return node;
}

/** External link. Only http(s) URLs are accepted; anything else becomes plain text. */
export function link(text: string, href: string): HTMLElement {
  if (!/^https?:\/\//.test(href)) return make('span', undefined, text);
  const a = make('a', undefined, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Wire the Close button, backdrop click and return focus for a <dialog>. */
export function setupDialog(dialog: HTMLDialogElement): void {
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
