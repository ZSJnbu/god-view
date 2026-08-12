import { createPayment } from '../payment/index.js';

/** 下单：写入订单记录，然后创建支付单。 */
export async function placeOrder(order: { items: string[] }): Promise<void> {
  await saveOrder(order);
  await createPayment(order.items.length * 100);
}

async function saveOrder(order: { items: string[] }): Promise<void> {
  // 真实项目会写 Postgres，这里只是夹具。
  await Promise.resolve(order);
}
