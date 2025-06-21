"use client";

import { createCart, updateCart } from "@/app/api/services/cart";
import Cookies from "js-cookie";
import { useCart } from "react-use-cart";

const getCartSessionId = () => {
    return Cookies.get("cart-session");
};

export function AddToCartWrapper({
    children,
    imageUrl,
    price,
    productId,
    quantity,
    title,
    variantId,
}: any) {
    const { addItem } = useCart();

    const cartSessionId = getCartSessionId();

    const handleAddItem = async () => {
        addItem(
            {
                id: variantId,
                imageUrl,
                price,
                productId,
                title,
                variantId,
            },
            quantity
        );

        if (cartSessionId) {
            await updateCart({
                id: variantId,
                quantity,
            });
        } else {
            await createCart({
                id: variantId,
                quantity,
            });
        }
    };

    return (
        <div
            onClick={handleAddItem}
            onKeyDown={async (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    await handleAddItem();
                }
            }}
            role="button"
            tabIndex={0}
        >
            {children}
        </div>
    );
}
