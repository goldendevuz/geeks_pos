import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartNameFields } from '../utils/posCartName'
import { formatPosCartLineName } from '../utils/posCartName'

export type CartLine = {
  variantId: string
  productId: string
  colorId: string
  barcode: string
  name: string
  nameFields?: CartNameFields
  sizeLabel: string
  colorLabel: string
  listPrice: string
  stockQty?: number
  qty: number
}

export type PayMode = 'CASH' | 'CARD' | 'DEBT'

export type SuspendedCart = {
  id: string
  items: CartLine[]
  total: number
  timestamp: string
  label: string
}

type PosState = {
  cart: CartLine[]
  suspendedCarts: SuspendedCart[]
  sessionSeq: number
  payMode: PayMode
  customerName: string
  customerPhone: string
  addLine: (line: Omit<CartLine, 'qty'> & { qty?: number }) => void
  incQty: (variantId: string, delta: number) => void
  clearCart: () => void
  setPayMode: (m: PayMode) => void
  setCustomer: (name: string, phone: string) => void
  updateLinePrice: (variantId: string, listPrice: string) => void
  updateLineStock: (variantId: string, stockQty: number) => void
  setCart: (items: CartLine[]) => void
  refreshCartNames: (lang: string) => void
  holdCart: (payload: { items: CartLine[]; total: number; label?: string }) => SuspendedCart
  resumeCart: (id: string) => SuspendedCart | null
  deleteSuspendedCart: (id: string) => void
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      cart: [],
      suspendedCarts: [],
      sessionSeq: 0,
      payMode: 'CASH',
      customerName: '',
      customerPhone: '',
      addLine: (line) => {
        const cart = get().cart
        const existing = cart.find((c) => c.variantId === line.variantId)
        const add = line.qty ?? 1
        if (existing) {
          set({
            cart: cart.map((c) =>
              c.variantId === line.variantId
                ? {
                    ...c,
                    qty: c.qty + add,
                    productId: c.productId || line.productId,
                    colorId: c.colorId || line.colorId,
                    nameFields: line.nameFields ?? c.nameFields,
                    name: line.name || c.name,
                  }
                : c,
            ),
          })
        } else {
          set({
            cart: [
              ...cart,
              {
                variantId: line.variantId,
                productId: line.productId,
                colorId: line.colorId,
                barcode: line.barcode,
                name: line.name,
                nameFields: line.nameFields,
                sizeLabel: line.sizeLabel,
                colorLabel: line.colorLabel,
                listPrice: line.listPrice,
                stockQty: line.stockQty,
                qty: add,
              },
            ],
          })
        }
      },
      incQty: (variantId, delta) => {
        set({
          cart: get()
            .cart.map((c) =>
              c.variantId === variantId ? { ...c, qty: Math.max(0, c.qty + delta) } : c,
            )
            .filter((c) => c.qty > 0),
        })
      },
      clearCart: () => set({ cart: [] }),
      setPayMode: (m) => set({ payMode: m }),
      setCustomer: (name, phone) => set({ customerName: name, customerPhone: phone }),
      updateLinePrice: (variantId, listPrice) =>
        set({
          cart: get().cart.map((c) => (c.variantId === variantId ? { ...c, listPrice } : c)),
        }),
      updateLineStock: (variantId, stockQty) =>
        set({
          cart: get().cart.map((c) => (c.variantId === variantId ? { ...c, stockQty } : c)),
        }),
      setCart: (items) => set({ cart: items }),
      refreshCartNames: (lang) => {
        set({
          cart: get().cart.map((c) =>
            c.nameFields
              ? { ...c, name: formatPosCartLineName(c.nameFields, lang) }
              : c,
          ),
        })
      },
      holdCart: ({ items, total, label }) => {
        const nextSeq = get().sessionSeq + 1
        const cartLabel = label || `Mijoz #${nextSeq}`
        const now = new Date()
        const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        const suspended: SuspendedCart = {
          id: crypto.randomUUID(),
          items,
          total,
          timestamp,
          label: cartLabel,
        }
        set((state) => ({
          suspendedCarts: [suspended, ...state.suspendedCarts],
          sessionSeq: nextSeq,
        }))
        return suspended
      },
      resumeCart: (id) => {
        const found = get().suspendedCarts.find((c) => c.id === id) || null
        if (!found) return null
        set((state) => ({
          suspendedCarts: state.suspendedCarts.filter((c) => c.id !== id),
        }))
        return found
      },
      deleteSuspendedCart: (id) =>
        set((state) => ({
          suspendedCarts: state.suspendedCarts.filter((c) => c.id !== id),
        })),
    }),
    {
      name: 'geeks_pos_suspended_carts',
      partialize: (state) => ({
        suspendedCarts: state.suspendedCarts,
        sessionSeq: state.sessionSeq,
      }),
    },
  ),
)
