"use client";

import { useCart } from "react-use-cart";

export function DeleteItemWrapper({ children, variantId }: any) {
    const { removeItem } = useCart();

    const handleDeleteItem = () => {
        removeItem(variantId);
    };
    return (
        <div
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteItem();
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    handleDeleteItem();
                }
            }}
            role="button"
            tabIndex={0}
        >
            {children}
        </div>
    );
}
