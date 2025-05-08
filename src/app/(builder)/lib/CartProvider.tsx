"use client";

import { builder } from "@builder.io/sdk";
import { createContext, use, useState } from "react";

export interface CartItem {
    [key: string]: any;
    id: number | string;
    quantity: number;
}

interface CartContextType {
    addToCart: ({ productId, quantity, variantId }: any) => void;
    cart: CartItem[];
    updateCart: (productId: CartItem["id"], quantity: number) => void;
}

const CartContext = createContext<CartContextType | null>(null);

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
    const [cart, setCart] = useState<CartItem[]>([]);

    const addToCart = ({ productId, variantId }: any) => {
        setCart((prev) => [...prev]);
    };

    const updateCart = (productId: CartItem["id"], quantity: number) => {
        setCart((prev) =>
            prev.map((item) => {
                return item.id === productId ? { ...item, quantity } : item;
            })
        );
    };

    return (
        <CartContext value={{ addToCart, cart, updateCart }}>
            {children}
        </CartContext>
    );
};

export const useCart = (): CartContextType => {
    const context = use(CartContext);
    if (!context) {
        throw new Error("useCart must be used within a CartProvider");
    }
    return context;
};
