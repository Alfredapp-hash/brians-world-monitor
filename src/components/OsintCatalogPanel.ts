import { Panel } from './Panel';
import { OsintCatalogView } from '@/osint/catalog-view';
import { OSINT_CATALOG_PANEL_ID, OSINT_DISPATCH_NAME } from '@/osint/dispatch';

export class OsintCatalogPanel extends Panel {
  private readonly view: OsintCatalogView;

  constructor() {
    super({
      id: OSINT_CATALOG_PANEL_ID,
      title: OSINT_DISPATCH_NAME,
      showCount: true,
      infoTooltip:
        `${OSINT_DISPATCH_NAME} loads catalog.meta.json plus toolShardFiles. External links open in a new tab.`,
    });
    this.element.classList.add('panel-tall');
    this.view = new OsintCatalogView(this.content, {
      setCount: (count) => this.setCount(count),
      showLoading: (message) => this.showLoading(message),
      showError: (message, retry) => this.showError(message, retry),
      clearError: () => this.setErrorState(false),
    });
    this.view.refresh();
  }

  public refresh(): void {
    this.view.refresh();
  }

  protected render(): void {
    this.view.render();
  }
}
