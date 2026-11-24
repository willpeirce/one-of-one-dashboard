import { planStock, plannerDefaults, type PlannerProduct } from '../../../src/stock/planner.js';
import type { StockPlannerView } from '../../../src/stock/planner-store.js';

const today = '2032-08-12';

function product(name: string, market: PlannerProduct['market'], kit: boolean, available: number, dailyUse: number): PlannerProduct {
  return { name, market, kit, available, daily: new Map([['2032-08-11', available + dailyUse], [today, available]]) };
}

// Invented planner inputs in live mode so Ask exercises its model-facing stock tool.
export const askStockFixture: StockPlannerView = {
  mode: 'live', today, asOf: '2032-08-12T09:30:00Z',
  rows: planStock([
    product('Invented Reed Pack', 'us', false, 12, 3),
    product('Invented Prism Kit', 'uk', true, 84, 2),
    product('Invented Reed Pack', 'uk', false, 128, 2),
    product('Invented Foil', 'us', false, 28, 1),
  ], today, {
    ...plannerDefaults(),
    supplierLeadTimes: [{ supplier: 'Invented Works', days: 4, usDays: 19 }],
    productSuppliers: [{ product: 'Invented Reed Pack', supplier: 'Invented Works' }],
    inboundStock: [{ product: 'Invented Reed Pack', market: 'us', expectedDate: '2032-09-04', quantity: 54 }],
  }),
};
