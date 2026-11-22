/**
 * Smooth HTML/CSS loading transition overlay shown while unloading the prior
 * environment, disposing VRAM, and loading the target environment.
 */
export class LoadingView {
  readonly element: HTMLDivElement;
  private readonly labelEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'stapler-loading-overlay';
    this.element.hidden = true;

    const card = document.createElement('div');
    card.className = 'stapler-loading-card';

    const spinner = document.createElement('div');
    spinner.className = 'stapler-loading-spinner';

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'stapler-loading-label';
    this.labelEl.textContent = 'Loading...';

    card.append(spinner, this.labelEl);
    this.element.appendChild(card);
    parent.appendChild(this.element);
  }

  show(label = 'Loading...'): void {
    this.labelEl.textContent = label;
    this.element.hidden = false;
    this.element.classList.add('is-visible');
  }

  hide(): void {
    this.element.classList.remove('is-visible');
    this.element.hidden = true;
  }
}
