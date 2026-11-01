export type Product = { id: string; name: string; price: number; stock: number };

const PRODUCTS: Product[] = Array.from({ length: 8 }, (_, i) => ({
  id: `prd_${i + 1}`,
  name: ["Desk", "Chair", "Lamp", "Shelf", "Monitor arm", "Cable tray", "Footrest", "Whiteboard"][i]!,
  price: 25 + i * 20,
  stock: (i * 7) % 15,
}));

export async function getProducts(): Promise<Product[]> {
  await new Promise((r) => setTimeout(r, 800));
  return PRODUCTS;
}
