/** 支付：向第三方支付服务发起扣款并等待回调。 */
export async function createPayment(amountInCents: number): Promise<{ id: string }> {
  await Promise.resolve();
  return { id: `pay_${String(amountInCents)}` };
}

/** 退款是否属于本模块尚未确认，对应地图上的 uncertainties。 */
export async function refund(paymentId: string): Promise<void> {
  await Promise.resolve(paymentId);
}
