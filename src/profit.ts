/** All components are pounds; keep the shared numerator unrounded until display. */
export function profitAndMargin({
  netSales,
  shippingIncome = 0,
  landedCost = 0,
  fulfilment = 0,
  paymentFees = 0,
  adSpend = 0,
  overheads = 0,
}: {
  netSales: number;
  shippingIncome?: number;
  landedCost?: number;
  fulfilment?: number;
  paymentFees?: number;
  adSpend?: number;
  overheads?: number;
}): { profit: number; margin: number } {
  const profit = netSales + shippingIncome - landedCost - fulfilment - paymentFees - adSpend - overheads;
  return { profit, margin: netSales > 0 ? 100 * profit / netSales : 0 };
}
