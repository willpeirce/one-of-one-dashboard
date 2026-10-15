/** All components are pounds; keep the shared numerator unrounded until display. */
export function profitAndMargin({
  netSales,
  shippingIncome = 0,
  shippingRefunds = 0,
  landedCost = 0,
  fulfilment = 0,
  paymentFees = 0,
  adSpend = 0,
  overheads = 0,
}: {
  netSales: number;
  shippingIncome?: number;
  shippingRefunds?: number;
  landedCost?: number;
  fulfilment?: number;
  paymentFees?: number;
  adSpend?: number;
  overheads?: number;
}): { profit: number; margin: number; contribution: number; contributionMargin: number | null } {
  const contribution = netSales + shippingIncome - shippingRefunds - landedCost - fulfilment - paymentFees;
  const profit = contribution - adSpend - overheads;
  return { profit, margin: netSales > 0 ? 100 * profit / netSales : 0,
    contribution, contributionMargin: netSales !== 0 ? 100 * contribution / netSales : null };
}
