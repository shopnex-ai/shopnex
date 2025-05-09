import type { Block, GlobalConfig } from "payload";

import { admins } from "@/access/roles";
import { groups } from "@/collections/groups";

const BasicFooter: Block = {
    slug: "basic-footer",
    fields: [
        {
            name: "copyright",
            type: "richText",
            required: true,
        },
        {
            name: "poweredBy",
            type: "richText",
        },
    ],
};

export const Footer: GlobalConfig = {
    slug: "footer",
    access: {
        read: admins,
        update: admins,
    },
    admin: {
        group: groups.design,
    },
    fields: [
        {
            name: "type",
            type: "blocks",
            blocks: [BasicFooter],
            maxRows: 1,
        },
    ],
};
