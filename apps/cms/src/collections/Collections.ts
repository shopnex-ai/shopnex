import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";
import { description } from "@/fields/description";
import { HandleField } from "@/fields/handle";

import { groups } from "./groups";
import { SeoField } from "@/fields/seo";

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
            name: "image",
            type: "upload",
            relationTo: "media",
        },
        {
            name: "imageUrl",
            type: "text",
            admin: {
                description: "Alternative image URL if not using upload",
            },
        },
        HandleField(),
        description(),
        {
            name: "products",
            type: "join",
            collection: "products",
            hasMany: true,
            on: "collections",
            maxDepth: 5,
        },
        SeoField(),
    ],
};
