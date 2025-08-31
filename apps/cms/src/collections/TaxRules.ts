import type { CollectionConfig } from "payload";

import { admins } from "@/access/roles";

import { groups } from "./groups";

export const TaxRules: CollectionConfig = {
    slug: "tax-rules",
    access: {
        create: admins,
        delete: admins,
        read: admins,
        update: admins,
    },
    admin: {
        group: groups.orders,
        useAsTitle: "name",
        defaultColumns: ["name", "rate", "region", "active"],
    },
    fields: [
        {
            name: "name",
            type: "text",
            required: true,
            admin: {
                description: "Name for this tax rule (e.g., 'California Sales Tax', 'UK VAT')",
            },
        },
        {
            type: "row",
            fields: [
                {
                    name: "rate",
                    type: "number",
                    required: true,
                    min: 0,
                    max: 100,
                    admin: {
                        description: "Tax rate as percentage (e.g., 8.5 for 8.5%)",
                        step: 0.01,
                    },
                },
                {
                    name: "taxType",
                    type: "select",
                    required: true,
                    defaultValue: "sales_tax",
                    options: [
                        { label: "Sales Tax", value: "sales_tax" },
                        { label: "VAT", value: "vat" },
                        { label: "GST", value: "gst" },
                        { label: "Other", value: "other" },
                    ],
                },
            ],
        },
        {
            name: "region",
            type: "group",
            fields: [
                {
                    type: "row",
                    fields: [
                        {
                            name: "country",
                            type: "text",
                            required: true,
                            admin: {
                                description: "Country code (e.g., US, UK, CA)",
                                placeholder: "US",
                            },
                        },
                        {
                            name: "state",
                            type: "text",
                            admin: {
                                description: "State/Province code (e.g., CA, NY, ON)",
                                placeholder: "CA",
                            },
                        },
                    ],
                },
                {
                    type: "row",
                    fields: [
                        {
                            name: "city",
                            type: "text",
                            admin: {
                                description: "Specific city (optional)",
                                placeholder: "San Francisco",
                            },
                        },
                        {
                            name: "zipCode",
                            type: "text",
                            admin: {
                                description: "Specific ZIP/postal code (optional)",
                                placeholder: "94102",
                            },
                        },
                    ],
                },
            ],
        },
        {
            name: "applicableProducts",
            type: "relationship",
            relationTo: "products",
            hasMany: true,
            admin: {
                description: "Leave empty to apply to all products, or select specific products",
            },
        },
        {
            name: "applicableCollections",
            type: "relationship",
            relationTo: "collections",
            hasMany: true,
            admin: {
                description: "Apply tax to specific collections/categories",
            },
        },
        {
            name: "exemptProducts",
            type: "relationship",
            relationTo: "products",
            hasMany: true,
            admin: {
                description: "Products exempt from this tax rule",
            },
        },
        {
            type: "row",
            fields: [
                {
                    name: "includeShipping",
                    type: "checkbox",
                    defaultValue: false,
                    admin: {
                        description: "Apply tax to shipping costs",
                    },
                },
                {
                    name: "compoundTax",
                    type: "checkbox",
                    defaultValue: false,
                    admin: {
                        description: "Calculate tax on top of other taxes",
                    },
                },
            ],
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
                    name: "priority",
                    type: "number",
                    defaultValue: 1,
                    min: 1,
                    admin: {
                        description: "Priority order for applying multiple tax rules (lower number = higher priority)",
                        position: "sidebar",
                    },
                },
            ],
        },
        {
            name: "description",
            type: "textarea",
            admin: {
                description: "Internal notes about this tax rule",
            },
        },
    ],
};