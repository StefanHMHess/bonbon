function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function getReceiptSumConsistencyStatus(receipt) {
  const items = Array.isArray(receipt?.receipt_items) ? receipt.receipt_items : [];
  const activeItems = items.filter((item) => item?.is_ignored !== true);

  if (!activeItems.length) {
    const currentTotal = roundMoney(Number(receipt?.total_amount || 0));
    return {
      itemCount: activeItems.length,
      computedTotal: currentTotal,
      currentTotal,
      diff: 0,
      isConsistent: true,
    };
  }

  const computedTotal = roundMoney(activeItems.reduce((sum, item) => sum + Number(item?.amount || 0), 0));
  const currentTotal = roundMoney(Number(receipt?.total_amount || 0));
  const diff = Math.abs(computedTotal - currentTotal);

  return {
    itemCount: activeItems.length,
    computedTotal,
    currentTotal,
    diff,
    isConsistent: diff <= 0.01,
  };
}
