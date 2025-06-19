import type { CollectionConfig } from "payload";

import { admins, adminsOrSelf, anyone } from "@/access/roles";

import { groups } from "./groups";

export const Orders: CollectionConfig = {
    slug: "orders",
    access: {
        create: anyone,
        delete: admins,
        read: adminsOrSelf,
        update: admins,
    },
    admin: {
        group: groups.orders,
        useAsTitle: "orderId",
    },
    fields: [
        {
            name: "orderId",
            type: "text",
            required: true,
            unique: true, // Ensures no duplicate orders
        },
        {
            name: "user",
            type: "relationship",
            relationTo: "users",
            required: false,
        },
        {
            name: "items",
            type: "array",
            fields: [
                {
                    name: "product",
                    type: "relationship",
                    relationTo: "products",
                    required: false,
                },
                {
                    name: "variant",
                    type: "group",
                    fields: [
                        {
                            name: "variantId",
                            type: "text",
                            required: true,
                        },
                        {
                            name: "name",
                            type: "text",
                            required: true,
                        },
                        {
                            name: "price",
                            type: "number",
                            required: true,
                        },
                    ],
                },
                {
                    name: "quantity",
                    type: "number",
                    min: 1,
                    required: true,
                },
                {
                    name: "totalPrice",
                    type: "number",
                    required: true,
                },
            ],
            required: true,
        },
        {
            name: "totalAmount",
            type: "number",
            min: 0,
            required: true,
        },
        {
            name: "currency",
            type: "text",
            admin: {
                position: "sidebar",
            },
            required: true,
        },
        {
            name: "paymentStatus",
            type: "select",
            defaultValue: "pending",
            options: [
                { label: "Pending", value: "pending" },
                { label: "Paid", value: "paid" },
                { label: "Failed", value: "failed" },
                { label: "Refunded", value: "refunded" },
            ],
            required: true,
        },
        {
            name: "orderStatus",
            type: "select",
            defaultValue: "pending",
            options: [
                { label: "Pending", value: "pending" },
                { label: "Processing", value: "processing" },
                { label: "Shipped", value: "shipped" },
                { label: "Delivered", value: "delivered" },
                { label: "Canceled", value: "canceled" },
            ],
            required: true,
        },
        {
            name: "paymentIntentId",
            type: "text",
            admin: {
                readOnly: true,
            },
        },
        {
            name: "sessionId",
            type: "text",
            admin: {
                position: "sidebar",
                readOnly: true,
            },
            required: true,
        },
        {
            name: "paymentGateway",
            type: "select",
            options: [{ label: "Stripe", value: "stripe" }],
        },
        {
            name: "paymentMethod",
            type: "text",
            admin: {
                position: "sidebar",
            },
            required: false,
        },
        {
            name: "receiptUrl",
            type: "text",
            admin: {
                readOnly: true,
            },
            required: false,
        },
        {
            name: "metadata",
            type: "json",
            admin: {
                readOnly: true,
            },
        },
        {
            name: "shippingAddress",
            type: "json",
            admin: {
                position: "sidebar",
            },
            required: false,
            typescriptSchema: [
                () => ({
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        address: {
                            type: "object",
                            properties: {
                                city: { type: "string" },
                                country: { type: "string" },
                                line1: { type: "string" },
                                line2: { type: "string" },
                                postal_code: { type: "string", required: true },
                                state: { type: "string" },
                                street: { type: "string" },
                            },
                        },
                        phone: { type: "string" },
                    },
                }),
            ],
        },
        {
            name: "billingAddress",
            type: "json",
            admin: {
                position: "sidebar",
            },
            required: false,
            typescriptSchema: [
                () => ({
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        address: {
                            type: "object",
                            properties: {
                                city: { type: "string" },
                                country: { type: "string" },
                                line1: { type: "string" },
                                line2: { type: "string" },
                                postal_code: {
                                    type: "string",
                                },
                                state: { type: "string" },
                            },
                        },
                        email: { type: "string" },
                        phone: { type: "string" },
                    },
                }),
            ],
        },
        {
            name: "updatedAt",
            type: "date",
            admin: {
                readOnly: true,
            },
            defaultValue: () => new Date(),
        },
        {
            name: "createdAt",
            type: "date",
            admin: {
                readOnly: true,
            },
            defaultValue: () => new Date(),
        },
    ],
};
