import type { Block, CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";

import { groups } from "./groups";

export const CustomShipping: Block = {
    slug: "custom-shipping",
    admin: {
        disableBlockName: true,
        group: groups.settings,
    },
    fields: [
        {
            name: "label",
            type: "text",
            defaultValue: "Standard Shipping",
            label: "Label Shown to Customer",
            required: true,
        },
        {
            name: "baseRate",
            type: "number",
            label: "Base Rate (flat rate)",
            required: true,
        },
        {
            type: "row",
            fields: [
                {
                    name: "freeShippingMinOrder",
                    type: "number",
                    admin: {
                        description:
                            "If set, shipping is free for orders above this amount.",
                    },
                    label: "Free Shipping Over (optional)",
                },
                {
                    name: "estimatedDeliveryDays",
                    type: "text",
                    admin: {
                        description: "Example: '3-5 business days'",
                    },
                    label: "Estimated Delivery (optional)",
                },
            ],
        },
        {
            name: "notes",
            type: "textarea",
            admin: {
                description: "Visible to customers if needed.",
            },
            label: "Notes (optional)",
        },
    ],
    labels: {
        plural: "Custom Shipping",
        singular: "Custom Shipping",
    },
};

export const Shipping: CollectionConfig = {
    slug: "shipping",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        group: groups.settings,
        useAsTitle: "name",
    },
    fields: [
        {
            name: "name",
            type: "text",
            label: "Shipping Name",
            required: true,
        },
        {
            name: "enabled",
            type: "checkbox",
            admin: {
                position: "sidebar",
            },
            defaultValue: true,
        },
        {
            name: "location",
            type: "relationship",
            admin: {
                position: "sidebar",
            },
            relationTo: "locations",
        },
        {
            name: "shippingProvider",
            type: "blocks",
            admin: {
                description: "Select a shipping provider",
            },
            blocks: [CustomShipping],
        },
    ],
    labels: {
        plural: "Shipping",
        singular: "Shipping",
    },
};
