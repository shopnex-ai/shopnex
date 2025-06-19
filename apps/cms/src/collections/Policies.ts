import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";
import { handleField } from "@/fields/slug";

export const Policies: CollectionConfig = {
    slug: "policies",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        defaultColumns: ["title", "handle", "createdAt", "updatedAt"],
        group: "Settings",
        useAsTitle: "title",
    },
    fields: [
        {
            name: "title",
            type: "text",
            required: true,
        },
        {
            name: "description",
            type: "richText",
        },
        handleField(),
    ],
};
