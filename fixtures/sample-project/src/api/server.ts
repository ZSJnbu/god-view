import { placeOrder } from '../orders/index.js';

/** HTTP 入口：接收并校验外部请求，再交给订单模块。 */
export async function handleRequest(body: unknown): Promise<{ status: number }> {
  if (typeof body !== 'object' || body === null) {
    return { status: 400 };
  }
  await placeOrder(body as { items: string[] });
  return { status: 201 };
}
