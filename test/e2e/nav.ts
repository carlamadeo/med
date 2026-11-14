import type {Page} from '@playwright/test';

/**
 * Navigate through the sidebar. On narrow viewports the sidebar is off-canvas, so the menu has to
 * be opened before the item becomes visible.
 */
export async function navigateTo(page: Page, view: string): Promise<void> {
    const item = page.locator(`#nav-${view}`);
    if (!(await item.isVisible())) {
        await page.getByRole('button', {name: 'Abrir menú'}).click();
    }
    await item.click();
}
