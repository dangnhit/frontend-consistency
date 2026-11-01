import { getProducts } from "@/lib/products";

export default async function ProductsPage() {
  const products = await getProducts();
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <h1 className="mb-4 text-xl font-bold">Products</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {products.map((p) => (
          <div key={p.id} className="rounded-lg border p-4">
            <p className="font-medium">{p.name}</p>
            <p className="text-sm text-muted-foreground">
              ${p.price} · {p.stock} in stock
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
