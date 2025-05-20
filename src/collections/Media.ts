import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";

import { groups } from "./groups";

export const Media: CollectionConfig = {
    slug: "media",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        group: groups.content,
    },
    fields: [
        {
            name: "alt",
            type: "text",
            required: true,
        },
    ],
    upload: true,
};
