import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";

import { groups } from "../groups";
import { validateCouponEndpoint } from "./endpoints/validate-coupon";

export const Coupons: CollectionConfig = {
    slug: "coupons",
    access: {
        create: admins,
        delete: admins,
        read: admins,
        update: admins,
    },
    admin: {
        group: groups.orders,
        useAsTitle: "code",
        defaultColumns: [
            "code",
            "discountType",
            "discountValue",
            "active",
            "usageCount",
            "expiresAt",
        ],
    },
    endpoints: [validateCouponEndpoint],
    fields: [
        {
            name: "code",
            type: "text",
            required: true,
            unique: true,
            admin: {
                description: "Unique coupon code that customers will enter",
            },
        },
        {
            type: "row",
            fields: [
                {
                    name: "discountType",
                    type: "select",
                    required: true,
                    defaultValue: "percentage",
                    options: [
                        { label: "Percentage Off", value: "percentage" },
                        { label: "Fixed Amount Off", value: "fixed" },
                        { label: "Free Shipping", value: "free_shipping" },
                    ],
                },
                {
                    name: "discountValue",
                    type: "number",
                    required: true,
                    min: 0,
                    admin: {
                        description:
                            "For percentage: enter value without % (e.g., 10 for 10%). For fixed: enter amount in store currency.",
                        condition: (data) =>
                            data.discountType !== "free_shipping",
                    },
                },
            ],
        },
        {
            type: "row",
            fields: [
                {
                    name: "minimumOrderAmount",
                    type: "number",
                    min: 0,
                    admin: {
                        description:
                            "Minimum order amount required to use this coupon",
                    },
                },
                {
                    name: "maximumDiscountAmount",
                    type: "number",
                    min: 0,
                    admin: {
                        description:
                            "Maximum discount amount (useful for percentage coupons)",
                        condition: (data) => data.discountType === "percentage",
                    },
                },
            ],
        },
        {
            type: "row",
            fields: [
                {
                    name: "usageLimit",
                    type: "number",
                    min: 1,
                    admin: {
                        description:
                            "Maximum number of times this coupon can be used (leave empty for unlimited)",
                    },
                },
                {
                    name: "usageLimitPerCustomer",
                    type: "number",
                    min: 1,
                    admin: {
                        description:
                            "Maximum uses per customer (leave empty for unlimited)",
                    },
                },
            ],
        },
        {
            type: "row",
            fields: [
                {
                    name: "startsAt",
                    type: "date",
                    admin: {
                        date: {
                            pickerAppearance: "dayAndTime",
                        },
                        description: "When this coupon becomes active",
                    },
                },
                {
                    name: "expiresAt",
                    type: "date",
                    admin: {
                        date: {
                            pickerAppearance: "dayAndTime",
                        },
                        description: "When this coupon expires",
                    },
                },
            ],
        },
        {
            name: "applicableProducts",
            type: "relationship",
            relationTo: "products",
            hasMany: true,
            admin: {
                description:
                    "Leave empty to apply to all products, or select specific products",
            },
        },
        {
            name: "applicableCollections",
            type: "relationship",
            relationTo: "collections",
            hasMany: true,
            admin: {
                description: "Apply coupon to specific collections/categories",
            },
        },
        {
            name: "excludedProducts",
            type: "relationship",
            relationTo: "products",
            hasMany: true,
            admin: {
                description: "Products that this coupon cannot be applied to",
            },
        },
        {
            type: "row",
            fields: [
                {
                    name: "active",
                    type: "checkbox",
                    defaultValue: true,
                    admin: {
                        position: "sidebar",
                    },
                },
                {
                    name: "usageCount",
                    type: "number",
                    defaultValue: 0,
                    admin: {
                        readOnly: true,
                        position: "sidebar",
                        description:
                            "Number of times this coupon has been used",
                    },
                },
            ],
        },
        {
            name: "description",
            type: "textarea",
            admin: {
                description: "Internal description for admin reference",
            },
        },
    ],
    hooks: {
        beforeValidate: [
            ({ data }) => {
                if (data?.code) {
                    data.code = data.code.toUpperCase().replace(/\s+/g, "");
                }
                return data;
            },
        ],
    },
};
