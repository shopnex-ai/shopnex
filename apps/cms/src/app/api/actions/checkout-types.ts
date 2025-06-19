import type { User } from "@/payload-types";

export interface CartItem {
    gallery: Array<{ url: string }>;
    id: string;
    options: Array<{ option: string; value: string }>;
    price: number;
    quantity: number;
    selectedVariant: {
        id: string;
        price: number;
    };
    title: string;
}

export interface CheckoutResult {
    error?: string;
    sessionId?: string;
    url?: string;
}

export type PaymentStatus = "cancelled" | "completed" | "failed" | "pending";

export interface CreateOrderData {
    items: Array<{
        product: number;
        quantity: number;
        variant: string;
    }>;
    orderNumber: string;
    status: PaymentStatus;
    total: number;
    user: null | User;
}

export interface UpdateOrderStatusData {
    sessionId: string;
    status: PaymentStatus;
}
