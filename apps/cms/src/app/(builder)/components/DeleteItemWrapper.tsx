"use client";

import { updateCart } from "@/app/api/services/cart";
import { useCart } from "react-use-cart";

export function DeleteItemWrapper({ children, variantId }: any) {
    const { removeItem } = useCart();

    const handleDeleteItem = async () => {
        removeItem(variantId);
        await updateCart({
            id: variantId,
            quantity: 0,
        });
    };
    return (
        <div
            onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await handleDeleteItem();
            }}
            onKeyDown={async (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    await handleDeleteItem();
                }
            }}
            role="button"
            tabIndex={0}
        >
            {children}
        </div>
    );
}
