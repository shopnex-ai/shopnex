"use client";

import { useCart } from "react-use-cart";

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

    const handleAddItem = () => {
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
    };

    return (
        <div
            onClick={handleAddItem}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    handleAddItem();
                }
            }}
            role="button"
            tabIndex={0}
        >
            {children}
        </div>
    );
}
