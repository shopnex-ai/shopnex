import { type CollectionConfig } from "payload";
import { groups } from "../groups";
import { canAccessOwnCart } from "./access/access-own-cart";
import { sessionCartCreate } from "./hooks/session-cart-create";
import { createCartSession, updateCartSession } from "./endpoints/cart-session";

export const Carts: CollectionConfig = {
    slug: "carts",
    access: {
        create: canAccessOwnCart,
        delete: canAccessOwnCart,
        read: canAccessOwnCart,
        update: canAccessOwnCart,
    },
    admin: {
        group: groups.customers,
        useAsTitle: "sessionId",
    },
    endpoints: [createCartSession, updateCartSession],
    fields: [
        {
            name: "sessionId",
            type: "text",
            admin: {
                position: "sidebar",
                readOnly: true,
            },
        },
        {
            name: "customer",
            type: "relationship",
            admin: {
                position: "sidebar",
            },
            relationTo: "users",
        },
        {
            name: "cartItems",
            type: "array",
            fields: [
                {
                    name: "variantId",
                    type: "text",
                    required: true,
                },
                {
                    name: "product",
                    type: "relationship",
                    relationTo: "products",
                    required: true,
                },
                {
                    name: "quantity",
                    type: "number",
                    required: true,
                },
            ],
        },
        {
            name: "completed",
            type: "checkbox",
            admin: {
                position: "sidebar",
            },
            defaultValue: false,
        },
    ],
};
