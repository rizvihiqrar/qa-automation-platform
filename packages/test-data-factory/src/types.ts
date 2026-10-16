export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  username: string;
  address: Address;
  createdAt: string;
}

export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  orderId: string;
  userId: string;
  product: string;
  category: string;
  quantity: number;
  unitPrice: number;
  total: number;
  status: OrderStatus;
  orderedAt: string;
  /** Only set for shipped and delivered orders, and never before orderedAt. */
  shippedAt: string | null;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  available: boolean;
  createdAt: string;
}

export type DataType = 'users' | 'orders' | 'products';
export type Format = 'json' | 'csv' | 'sql';
