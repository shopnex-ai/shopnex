import type { CollectionConfig } from "payload";

import { admins, adminsOrSelf } from "@/access/roles";

import { groups } from "./groups";

export const Customers: CollectionConfig = {
    slug: "customer",
    access: {
        create: adminsOrSelf,
        delete: admins,
        read: adminsOrSelf,
        update: adminsOrSelf,
    },
    admin: {
        group: groups.customers,
        useAsTitle: "user",
        defaultColumns: ["user", "totalOrders"],
    },
    fields: [
        {
            name: "user",
            type: "relationship",
            relationTo: "users",
            required: true,
            unique: true,
            admin: {
                description: "Associated user account",
            },
        },
        {
            name: "addresses",
            type: "array",
            admin: {
                description: "Saved customer addresses",
            },
            fields: [
                {
                    name: "label",
                    type: "text",
                    required: true,
                    admin: {
                        description:
                            "Address label (e.g., Home, Work, Billing)",
                    },
                },
                {
                    name: "isDefault",
                    type: "checkbox",
                    defaultValue: false,
                    admin: {
                        description: "Set as default address",
                    },
                },
                {
                    name: "addressType",
                    type: "select",
                    required: true,
                    options: [
                        { label: "Shipping", value: "shipping" },
                        { label: "Billing", value: "billing" },
                        { label: "Both", value: "both" },
                    ],
                    defaultValue: "both",
                },
                {
                    type: "row",
                    fields: [
                        {
                            name: "firstName",
                            type: "text",
                            required: true,
                        },
                        {
                            name: "lastName",
                            type: "text",
                            required: true,
                        },
                    ],
                },
                {
                    name: "company",
                    type: "text",
                },
                {
                    name: "address1",
                    type: "text",
                    required: true,
                    label: "Address Line 1",
                },
                {
                    name: "address2",
                    type: "text",
                    label: "Address Line 2",
                },
                {
                    type: "row",
                    fields: [
                        {
                            name: "city",
                            type: "text",
                            required: true,
                        },
                        {
                            name: "state",
                            type: "text",
                            required: true,
                        },
                        {
                            name: "zipCode",
                            type: "text",
                            required: true,
                            label: "ZIP/Postal Code",
                        },
                    ],
                },
                {
                    type: "row",
                    fields: [
                        {
                            name: "country",
                            type: "text",
                            required: true,
                            defaultValue: "US",
                        },
                        {
                            name: "phone",
                            type: "text",
                        },
                    ],
                },
            ],
        },
        {
            name: "statistics",
            type: "group",
            admin: {
                description: "Customer purchase statistics",
            },
            fields: [
                {
                    type: "row",
                    fields: [
                        {
                            name: "totalOrders",
                            type: "number",
                            defaultValue: 0,
                            min: 0,
                            admin: {
                                readOnly: true,
                                description: "Total number of orders placed",
                            },
                        },
                        {
                            name: "totalSpent",
                            type: "number",
                            defaultValue: 0,
                            min: 0,
                            admin: {
                                readOnly: true,
                                description: "Total amount spent",
                            },
                        },
                        {
                            name: "averageOrderValue",
                            type: "number",
                            defaultValue: 0,
                            min: 0,
                            admin: {
                                readOnly: true,
                                description: "Average order value",
                            },
                        },
                    ],
                },
                {
                    type: "row",
                    fields: [
                        {
                            name: "firstOrderDate",
                            type: "date",
                            admin: {
                                readOnly: true,
                                description: "Date of first order",
                            },
                        },
                        {
                            name: "lastOrderDate",
                            type: "date",
                            admin: {
                                readOnly: true,
                                description: "Date of most recent order",
                            },
                        },
                    ],
                },
            ],
        },
        {
            name: "notes",
            type: "textarea",
            admin: {
                description: "Internal notes about this customer",
            },
        },
    ],
};
