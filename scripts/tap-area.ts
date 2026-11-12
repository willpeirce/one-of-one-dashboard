import type { Locator } from 'playwright';

/** A small pill may carry an unseen ::before tap area (the Next up strip's Next and Add a date).
 * Returns the tap size, counting that area, and whether taps near its top and bottom edges reach the control. */
export async function tapArea(control: Locator): Promise<{ width: number; height: number; edges: boolean }> {
  const box = await control.boundingBox();
  const area = await control.evaluate(element => {
    const style = getComputedStyle(element, '::before'), rect = element.getBoundingClientRect();
    if (style.content === 'none' || style.position !== 'absolute') return null;
    const centreX = rect.left + rect.width / 2, centreY = rect.top + rect.height / 2, reach = parseFloat(style.height) / 2 - 3;
    return { width: rect.width - parseFloat(style.left) - parseFloat(style.right), height: parseFloat(style.height),
      edges: [centreY - reach, centreY + reach].every(y => element.contains(document.elementFromPoint(centreX, y))) };
  });
  return { width: Math.max(box?.width ?? 0, area?.width ?? 0), height: Math.max(box?.height ?? 0, area?.height ?? 0), edges: area === null || area.edges };
}
