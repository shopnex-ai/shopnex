import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";
import { handleField } from "@/fields/slug";

import { groups } from "./groups";

export const Pages: CollectionConfig = {
    slug: "pages",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        group: groups.design,
        useAsTitle: "title",
    },
    fields: [
        {
            name: "title",
            type: "text",
        },
        handleField(),
    ],
};
