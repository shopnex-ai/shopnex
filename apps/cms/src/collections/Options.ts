import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";

export const Options: CollectionConfig = {
    slug: "options",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        hidden: true,
        useAsTitle: "option",
    },
    fields: [
        {
            name: "product",
            type: "relationship",
            relationTo: "products",
            required: true,
        },
        {
            name: "product2",
            type: "relationship",
            relationTo: "products",
        },
        {
            name: "option",
            type: "text",
            required: true,
        },
        {
            name: "values",
            type: "array",
            fields: [
                {
                    name: "value",
                    type: "text",
                    required: true,
                },
            ],
            required: true,
        },
    ],
};
