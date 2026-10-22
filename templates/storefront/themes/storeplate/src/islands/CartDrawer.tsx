// Storeplate's cart drawer. Checkout is Shopnex's hosted page (cart.checkoutUrl).
// `placeholder`: the theme's image for lines without one (an asset URL, from the layout)
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { FaMinus, FaPlus, FaShoppingCart } from 'react-icons/fa'
import { IoClose } from 'react-icons/io5'
import {
  $cart,
  $cartError,
  $cartOpen,
  loadCart,
  reportCartError,
  setLineQuantity,
  type CartLine,
} from '@shopnex/storefront-sdk/cart'
import { formatMoney } from '@shopnex/storefront-sdk/money'

export default function CartDrawer({ placeholder }: { placeholder: string }) {
  const cart = useStore($cart)
  const open = useStore($cartOpen)
  const error = useStore($cartError)
  const close = () => $cartOpen.set(false)

  useEffect(() => void loadCart(), [])
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => $cartError.set(null), 5000)
    return () => clearTimeout(timer)
  }, [error])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const lines = cart?.lines ?? []

  return (
    <>
      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-60 -translate-x-1/2 rounded-md bg-dark px-5 py-3 text-sm text-white shadow"
        >
          {error}
        </div>
      )}
      <div
        className={`fixed inset-0 z-40 bg-black opacity-50 transition-opacity ${open ? 'block' : 'hidden'}`}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 w-full transform transition-transform duration-300 ease-in-out md:w-[390px] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col border-l border-neutral-200 bg-body p-6 text-black drop-shadow-lg">
          <div className="flex items-center justify-between border-b border-dark pb-4">
            <p className="text-lg font-semibold">Your Cart</p>
            <button type="button" aria-label="Close cart" onClick={close} className="text-2xl">
              <IoClose />
            </button>
          </div>

          {lines.length === 0 ? (
            <div className="my-auto flex flex-col items-center justify-center space-y-6">
              <FaShoppingCart size={76} />
              <p>Your cart is empty.</p>
              <a href="/products" className="btn btn-primary w-full" onClick={close}>
                Browse products
              </a>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col justify-between p-1">
              <ul className="grow overflow-auto py-4">
                {lines.map((line) => (
                  <Line key={line.id} line={line} placeholder={placeholder} onNavigate={close} />
                ))}
              </ul>
              <div className="py-4 text-sm text-neutral-500">
                {cart!.discountAllocations.map((d) => (
                  <div key={d.code} className="mb-3 flex items-center justify-between border-b border-neutral-200 pb-1">
                    <p>Discount ({d.code})</p>
                    <p className="text-right text-base text-black">−{formatMoney(d.discountedAmount)}</p>
                  </div>
                ))}
                <div className="mb-3 flex items-center justify-between border-b border-neutral-200 pt-1 pb-1">
                  <p>Shipping & taxes</p>
                  <p className="text-right">Calculated at checkout</p>
                </div>
                <div className="mb-3 flex items-center justify-between border-b border-neutral-200 pt-1 pb-1">
                  <p>Total</p>
                  <p className="text-right text-base text-black">{formatMoney(cart!.cost.totalAmount)}</p>
                </div>
              </div>
              <a
                href={cart!.checkoutUrl}
                className="block w-full rounded-md bg-dark p-3 text-center text-sm font-medium text-white hover:opacity-90"
              >
                Proceed to Checkout
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Line({ line, placeholder, onNavigate }: { line: CartLine; placeholder: string; onNavigate: () => void }) {
  const [pending, setPending] = useState(false)
  const { merchandise } = line

  async function setQuantity(quantity: number) {
    setPending(true)
    try {
      await setLineQuantity(line.id, quantity)
    } catch (error) {
      reportCartError(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <li className={`flex w-full flex-col border-b border-neutral-300 ${pending ? 'opacity-60' : ''}`}>
      <div className="relative flex w-full flex-row justify-between gap-2 px-1 py-4">
        <a
          href={`/products/${merchandise.product.handle}?variant=${merchandise.id}`}
          onClick={onNavigate}
          className="flex flex-row gap-4"
        >
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-neutral-300 bg-neutral-300">
            <img
              className="h-full w-full object-cover"
              src={merchandise.image?.url ?? placeholder}
              alt={merchandise.image?.altText ?? merchandise.product.title}
              width={64}
              height={64}
            />
          </div>
          <div className="flex flex-1 flex-col text-base">
            <span>{merchandise.product.title}</span>
            {merchandise.selectedOptions.length > 0 && <p className="text-sm text-neutral-500">{merchandise.title}</p>}
            {!line.availableForSale && <p className="text-sm text-red-600">Not enough in stock</p>}
          </div>
        </a>
        <div className="flex h-16 shrink-0 flex-col items-end justify-between">
          <p>{formatMoney(line.cost.totalAmount)}</p>
          <div className="flex items-center gap-x-1">
            <QuantityButton
              label={line.quantity === 1 ? 'Remove item' : 'Reduce item quantity'}
              disabled={pending}
              onClick={() => setQuantity(line.quantity - 1)}
            >
              <FaMinus className="h-3 w-3" />
            </QuantityButton>
            <p className="w-6 text-center">{line.quantity}</p>
            <QuantityButton
              label="Increase item quantity"
              disabled={pending}
              onClick={() => setQuantity(line.quantity + 1)}
            >
              <FaPlus className="h-3 w-3" />
            </QuantityButton>
          </div>
        </div>
      </div>
    </li>
  )
}

function QuantityButton(props: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-light disabled:cursor-not-allowed"
    >
      {props.children}
    </button>
  )
}
