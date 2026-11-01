"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { getOrders, type Order } from "@/lib/orders";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    getOrders().then(setOrders);
  }, []);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Orders</h1>
      {!orders ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Order</th>
              <th className="py-2">Customer</th>
              <th className="py-2">Total</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="py-2">{o.id}</td>
                <td className="py-2">{o.customer}</td>
                <td className="py-2">${o.total}</td>
                <td className="py-2 capitalize">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
