/** The existing action route's minor-unit budget bounds, shared with offered controls. */
export function allowedBudgetChange(base: number, minor: number, undo = false): boolean {
  return Number.isSafeInteger(base) && base >= 100 && Number.isSafeInteger(minor) && minor >= 100
    && (undo || minor <= Math.floor(base * 13 / 10));
}
