import type { CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";
import { description } from "@/fields/description";
import { handleField } from "@/fields/slug";

import { groups } from "../groups";
import { deleteMedia } from "./hooks/delete-media";

export const Products: CollectionConfig = {
    slug: "products",
    access: {
        create: admins,
        delete: admins,
        read: anyone,
        update: admins,
    },
    admin: {
        defaultColumns: ["title", "image", "variants", "collections"],
        group: groups.catalog,
        useAsTitle: "title",
    },
    fields: [
        {
            name: "image",
            type: "ui",
            admin: {
                components: {
                    Cell: "@/collections/Products/fields/ImageCell",
                },
            },
        },
        {
            name: "pid",
            type: "text",
            admin: {
                disabled: true,
            },
        },
        {
            name: "title",
            type: "text",
            required: true,
        },
        {
            name: "currency",
            type: "text",
            admin: {
                disabled: true,
            },
        },
        {
            name: "visible",
            type: "checkbox",
            admin: {
                position: "sidebar",
            },
            defaultValue: true,
            label: "Visibility",
        },
        {
            name: "salesChannels",
            type: "select",
            admin: {
                description:
                    "Choose where this product should be available to customers.",
                disabled: true,
                position: "sidebar",
            },
            defaultValue: "all",
            hasMany: true,
            label: "Sales Channels",
            options: [
                {
                    label: "All Channels",
                    value: "all",
                },
                {
                    label: "Online Store",
                    value: "onlineStore",
                },
                { label: "POS", value: "pos" },
                { label: "Mobile App", value: "mobileApp" },
            ],
        },
        {
            name: "source",
            type: "select",
            admin: {
                disabled: true,
                position: "sidebar",
            },
            defaultValue: "manual",
            options: [{ label: "Manual", value: "manual" }],
        },
        description(),
        {
            name: "collections",
            type: "relationship",
            admin: {
                position: "sidebar",
            },
            hasMany: true,
            label: "Tags",
            relationTo: "collections",
        },
        handleField(),
        {
            type: "collapsible",
            admin: {
                initCollapsed: true,
            },
            fields: [
                {
                    name: "variantOptions",
                    type: "array",
                    admin: {
                        description: "Choose the options for this product.",
                    },
                    fields: [
                        {
                            name: "option",
                            type: "text",
                            admin: {
                                placeholder: "Enter an option",
                            },
                            required: true,
                        },
                        {
                            name: "value",
                            type: "text",
                            admin: {
                                description:
                                    "(press enter to add multiple values)",
                                placeholder: "Enter a value",
                            },
                            hasMany: true,
                            required: true,
                        },
                    ],
                    maxRows: 5,
                },
                {
                    name: "buildVariantsButton",
                    type: "ui",
                    admin: {
                        components: {
                            Field: "@/collections/Products/fields/BuildVariantsButton",
                        },
                    },
                },
            ],
            label: "Build Variants",
        },

        {
            name: "variants",
            type: "array",
            fields: [
                {
                    name: "vid",
                    type: "text",
                    admin: {
                        disabled: true,
                    },
                    label: "Variant ID",
                },
                {
                    name: "imageUrl",
                    type: "text",
                    admin: {
                        disabled: true,
                    },
                    label: "Image",
                },
                {
                    name: "gallery",
                    type: "upload",
                    admin: {
                        components: {
                            // Field: "@/custom/custom-image-field#UploadField",
                        },
                        isSortable: false,
                    },
                    hasMany: true,
                    label: "Image",
                    relationTo: "media",
                },
                {
                    name: "price",
                    type: "number",
                    required: true,
                },
                {
                    name: "originalPrice",
                    type: "number",
                    admin: {
                        disabled: true,
                    },
                },

                {
                    name: "options",
                    type: "array",
                    fields: [
                        {
                            name: "option",
                            type: "text",
                            required: true,
                        },
                        {
                            name: "value",
                            type: "text",
                            required: true,
                        },
                    ],
                    label: "Options",
                },
            ],
            maxRows: 100,
            minRows: 1,
            required: true,
        },

        {
            name: "customFields",
            type: "array",
            admin: {
                description:
                    "Add additional product info such as care instructions, materials, or sizing notes.",
                position: "sidebar",
            },
            fields: [
                {
                    name: "name",
                    type: "text",
                    required: true,
                },
                {
                    name: "value",
                    type: "text",
                },
            ],
        },
    ],
    hooks: {
        afterDelete: [deleteMedia],
    },
};
