export type Order = { id: string; customer: string; total: number; status: "paid" | "pending" | "refunded" };

const ORDERS: Order[] = Array.from({ length: 10 }, (_, i) => ({
  id: `ord_${1000 + i}`,
  customer: ["Acme", "Globex", "Initech", "Umbrella", "Hooli"][i % 5]!,
  total: 49 + i * 13,
  status: (["paid", "pending", "refunded"] as const)[i % 3]!,
}));

export async function getOrders(): Promise<Order[]> {
  await new Promise((r) => setTimeout(r, 800));
  return ORDERS;
}
