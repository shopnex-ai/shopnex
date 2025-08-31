import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";

import { groups } from "../groups";
import { readOrderAccess } from "./access/order-access";
import { checkoutEndpoint } from "./endpoints/checkout";
import { OrderTimeline } from "./fields/OrderTimeline";
import { addOrderTimelineEntry } from "./hooks/add-order-timeline-entry";

export const Orders: CollectionConfig = {
    slug: "orders",
    access: {
        create: anyone,
        delete: admins,
        read: readOrderAccess,
        update: admins,
    },
    admin: {
        group: groups.orders,
        useAsTitle: "orderId",
    },
    endpoints: [checkoutEndpoint],
    fields: [
        {
            type: "row",
            fields: [
                {
                    name: "orderId",
                    type: "text",
                    required: true,
                    unique: true,
                    admin: {
                        readOnly: true,
                    },
                },
                {
                    name: "totalAmount",
                    type: "number",
                    min: 0,
                    required: true,
                },
            ],
        },
        {
            type: "row",
            fields: [
                {
                    name: "subtotal",
                    type: "number",
                    min: 0,
                    admin: {
                        description: "Subtotal before tax and shipping",
                    },
                },
                {
                    name: "taxAmount",
                    type: "number",
                    min: 0,
                    admin: {
                        description: "Total tax amount",
                    },
                },
                {
                    name: "shippingAmount",
                    type: "number",
                    min: 0,
                    admin: {
                        description: "Shipping cost",
                    },
                },
            ],
        },
        {
            type: "row",
            fields: [
                {
                    name: "user",
                    type: "relationship",
                    relationTo: "users",
                    required: false,
                },
                {
                    name: "cart",
                    type: "relationship",
                    relationTo: "carts",
                },
            ],
        },
        {
            name: "source",
            type: "select",
            admin: {
                position: "sidebar",
            },
            defaultValue: "manual",
            options: [{ label: "Manual", value: "manual" }],
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
            type: "row",
            fields: [
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
            ],
        },

        {
            type: "row",
            fields: [
                {
                    name: "payment",
                    type: "relationship",
                    relationTo: "payments",
                },
                {
                    name: "shipping",
                    type: "relationship",
                    relationTo: "shipping",
                },
            ],
        },
        {
            name: "paymentIntentId",
            type: "text",
            admin: {
                position: "sidebar",
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
        },
        {
            name: "sessionUrl",
            type: "text",
            admin: {
                disabled: true,
            },
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
            name: "taxBreakdown",
            type: "json",
            admin: {
                description: "Detailed tax calculation breakdown",
                readOnly: true,
            },
            typescriptSchema: [
                () => ({
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            ruleName: { type: "string" },
                            rate: { type: "number" },
                            amount: { type: "number" },
                            type: { type: "string" },
                        },
                    },
                }),
            ],
        },
        {
            name: "couponCode",
            type: "text",
            admin: {
                description: "Applied coupon code",
            },
        },
        {
            name: "discountAmount",
            type: "number",
            min: 0,
            admin: {
                description: "Total discount applied",
            },
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
        OrderTimeline,
    ],
    hooks: {
        beforeChange: [addOrderTimelineEntry],
    },
};
