import type { Block, CollectionConfig } from "payload";

import { admins, anyone } from "@/access/roles";

import { groups } from "./groups";

export const ManualProvider: Block = {
    slug: "manualProvider",
    admin: {
        disableBlockName: true,
    },
    fields: [
        {
            name: "providerName",
            type: "text",
        },
        {
            name: "methodType",
            type: "select",
            label: "Manual Payment Type",
            options: [
                { label: "Cash on Delivery", value: "cod" },
                { label: "Bank Transfer", value: "bankTransfer" },
                { label: "In-Store Payment", value: "inStore" },
                { label: "Other", value: "other" },
            ],
            required: true,
        },
        {
            name: "instructions",
            type: "textarea",
            admin: {
                description: "Shown to customers at checkout.",
            },
            label: "Payment Instructions",
            required: true,
        },
        {
            name: "details",
            type: "array",
            admin: {
                condition: (data) => {
                    const manualProvider = data?.providers.find(
                        (provider: any) =>
                            provider.blockType === "manualProvider"
                    );
                    return manualProvider?.methodType === "bankTransfer";
                },
            },
            fields: [
                {
                    type: "row",
                    fields: [
                        {
                            name: "label",
                            type: "text",
                            required: true,
                        },
                        {
                            name: "value",
                            type: "text",
                            required: true,
                        },
                    ],
                },
            ],
            label: "Details",
        },
    ],
    imageURL: "/manual-payment.png",
    labels: {
        plural: "Manual Providers",
        singular: "Manual Provider",
    },
};

export const Payments: CollectionConfig = {
    slug: "payments",
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
            name: "providers",
            type: "blocks",
            blocks: [ManualProvider],
            maxRows: 5,
        },
    ],
};
