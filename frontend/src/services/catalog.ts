import { request } from '../lib/api'
import type { Order, Page, Product } from '../lib/types'

export function listProducts(params: { category?: string; page?: number; size?: number } = {}) {
  const q = new URLSearchParams()
  if (params.category) q.set('category', params.category)
  q.set('page', String(params.page ?? 0))
  q.set('size', String(params.size ?? 20))
  return request<Page<Product>>(`/api/v1/products?${q.toString()}`, { auth: false })
}

export function getProduct(id: string) {
  return request<Product>(`/api/v1/products/${id}`, { auth: false })
}

export function createOrder(items: { productId: string; quantity: number }[]) {
  return request<Order>('/api/v1/orders', { method: 'POST', body: { items } })
}

export function listOrders(page = 0, size = 20) {
  return request<Page<Order>>(`/api/v1/orders?page=${page}&size=${size}`)
}

export function getOrder(id: string) {
  return request<Order>(`/api/v1/orders/${id}`)
}

export function markDelivered(orderId: string) {
  return request<Order>(`/api/v1/orders/${orderId}/deliver`, { method: 'POST' })
}
