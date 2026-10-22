import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { BsCart3 } from 'react-icons/bs'
import { $cart, $cartOpen, loadCart } from '@shopnex/storefront-sdk/cart'

export default function CartButton() {
  const cart = useStore($cart)
  useEffect(() => void loadCart(), [])
  const quantity = cart?.totalQuantity ?? 0

  return (
    <button
      type="button"
      onClick={() => $cartOpen.set(true)}
      aria-label={`Open cart${quantity ? `, ${quantity} items` : ''}`}
      className="relative text-xl text-text-dark hover:text-primary"
    >
      <BsCart3 />
      {quantity > 0 && (
        <span className="absolute -top-1 -right-3 flex h-5 w-5 items-center justify-center rounded-full bg-black p-1 text-xs text-white md:-top-2 md:-right-4">
          {quantity}
        </span>
      )}
    </button>
  )
}
