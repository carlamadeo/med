import {expect, type Page} from '@playwright/test';

/**
 * Navigate through the sidebar. On narrow viewports the sidebar is off-canvas, so the menu has to
 * be opened before the item becomes visible.
 */
export async function navigateTo(page: Page, view: string): Promise<void> {
    const item = page.locator(`#nav-${view}`);
    const menu = page.getByRole('button', {name: 'Abrir menú'});
    if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') {
        await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
    }
    await item.click();
    if (await menu.isVisible()) await expect(menu).toHaveAttribute('aria-expanded', 'false');
}
