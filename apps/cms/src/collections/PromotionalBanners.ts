import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";

import { groups } from "./groups";

export const PromotionalBanners: CollectionConfig = {
    slug: "promotional-banners",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        defaultColumns: ["title", "active", "priority", "createdAt"],
        group: groups.content,
        useAsTitle: "title",
    },
    fields: [
        {
            name: "title",
            type: "text",
            required: true,
        },
        {
            name: "subtitle",
            type: "text",
        },
        {
            name: "description",
            type: "textarea",
        },
        {
            name: "buttonText",
            type: "text",
            defaultValue: "Shop Now",
        },
        {
            name: "buttonUrl",
            type: "text",
        },
        {
            name: "image",
            type: "upload",
            relationTo: "media",
        },
        {
            name: "backgroundGradient",
            type: "select",
            defaultValue: "primary-secondary",
            options: [
                {
                    label: "Primary to Secondary",
                    value: "primary-secondary",
                },
                {
                    label: "Red to Orange",
                    value: "red-orange",
                },
                {
                    label: "Blue to Purple",
                    value: "blue-purple",
                },
                {
                    label: "Green to Teal",
                    value: "green-teal",
                },
            ],
        },
        {
            name: "active",
            type: "checkbox",
            admin: {
                position: "sidebar",
            },
            defaultValue: true,
            label: "Active",
        },
        {
            name: "priority",
            type: "number",
            admin: {
                description: "Higher numbers appear first",
                position: "sidebar",
            },
            defaultValue: 0,
        },
        {
            name: "startDate",
            type: "date",
            admin: {
                position: "sidebar",
            },
        },
        {
            name: "endDate",
            type: "date",
            admin: {
                position: "sidebar",
            },
        },
    ],
};
