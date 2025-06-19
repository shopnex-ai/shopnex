import type { Block, CollectionConfig } from "payload";

import { groups } from "./groups";

const ManualProvider: Block = {
    slug: "manual",
    admin: {
        group: groups.settings,
    },
    fields: [
        {
            name: "name",
            type: "text",
            access: {
                read: () => false,
                update: () => false,
            },
            label: "Name",
            required: true,
        },
        {
            name: "rate",
            type: "number",
            access: {
                read: () => false,
                update: () => false,
            },
            label: "Rate",
            required: true,
        },
    ],
};

export const Shipping: CollectionConfig = {
    slug: "shipping",
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
            blocks: [ManualProvider],
        },
    ],
    labels: {
        plural: "Shipping",
        singular: "Shipping",
    },
};
