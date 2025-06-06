import type { CollectionConfig } from "payload";

import { admins, adminsOrSelf, anyone } from "@/access/roles";

import { groups } from "./groups";

export const Users: CollectionConfig = {
    slug: "users",
    access: {
        create: anyone,
        delete: admins,
        read: adminsOrSelf,
        update: admins,
    },
    admin: {
        group: groups.customers,
        useAsTitle: "email",
    },

    auth: true,
    fields: [
        // Email added by default
        {
            name: "firstName",
            type: "text",
            label: "First Name",
        },
        {
            name: "lastName",
            type: "text",
            label: "Last Name",
        },
        {
            name: "roles",
            type: "select",
            access: {
                create: ({ req }) => {
                    const isAdmin = !!req.user?.roles?.includes("admin");
                    return isAdmin;
                },
                update: ({ req }) => {
                    const isAdmin = !!req.user?.roles?.includes("admin");
                    return isAdmin;
                },
            },
            defaultValue: ["customer"],
            hasMany: true,
            options: [
                {
                    label: "admin",
                    value: "admin",
                },
                {
                    label: "customer",
                    value: "customer",
                },
            ],
            saveToJWT: true,
        },
    ],
};
