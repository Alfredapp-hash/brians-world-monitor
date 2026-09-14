import './styles/osint4all.css';
import './styles/osint-catalog.css';
import { BRAND } from '@/config/brand';
import { OsintCatalogView } from '@/osint/catalog-view';
import { OSINT_DISPATCH_NAME, OSINT_DISPATCH_PATH } from '@/osint/dispatch';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function boot(): void {
  const root = document.getElementById('osintDispatchRoot');
  if (!root) return;

  const page = el('main', 'o4a osint-dispatch-page');
  const brand = el('a', 'o4a-brand', BRAND.name);
  brand.href = '/';
  page.append(brand);
  page.append(el('h1', '', OSINT_DISPATCH_NAME));
  page.append(
    el(
      'p',
      'o4a-lede',
      'The Public Dispatch OSINT catalog: search public investigation tools by job, tag, or category. Shards load from this origin. Nothing here is ranked because someone paid.',
    ),
  );

  const mount = el('div', 'osint-dispatch-catalog');
  page.append(mount);

  const nav = el('nav', 'o4a-nav');
  const about = el('a', '', 'About');
  about.href = BRAND.about;
  const editorial = el('a', '', 'OSINT4ALL editorial');
  editorial.href = BRAND.osint4all;
  const dash = el('a', '', 'Open the dashboard');
  dash.href = '/';
  nav.append(about, editorial, dash);
  page.append(nav);

  root.replaceChildren(page);

  if (window.location.pathname !== OSINT_DISPATCH_PATH && window.history.replaceState) {
    const next = `${OSINT_DISPATCH_PATH}${window.location.search}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }

  const view = new OsintCatalogView(mount);
  view.refresh();
}

boot();
