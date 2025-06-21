import { anyone } from "@/access/roles";
import { type CollectionConfig } from "payload";

import { groups } from "../groups";
import { canAccessOwnCart } from "./access/access-own-cart";
import { sessionCartCreate } from "./hooks/session-cart-create";

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
        useAsTitle: "id",
    },
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
                    name: "quantity",
                    type: "number",
                    required: true,
                },
            ],
        },
        {
            name: "completed",
            type: "checkbox",
            defaultValue: false,
            admin: {
                position: "sidebar",
            },
        },
    ],
    hooks: {
        afterChange: [sessionCartCreate],
        beforeValidate: [
            ({ data, operation }) => {
                if (operation !== "create" || !data) {
                    return;
                }
                const sessionId = crypto.randomUUID();

                data.sessionId = sessionId;
            },
        ],
    },
};
