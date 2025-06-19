import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";
import { description } from "@/fields/description";
import { handleField } from "@/fields/slug";

import { groups } from "./groups";

export const Collections: CollectionConfig = {
    slug: "collections",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        group: groups.catalog,
        useAsTitle: "title",
    },
    fields: [
        {
            name: "title",
            type: "text",
            required: true,
        },
        {
            name: "imageUrl",
            type: "text",
        },
        handleField(),
        description(),
        {
            name: "products",
            type: "join",
            collection: "products",
            hasMany: true,
            on: "collections",
        },
    ],
};
