import type { Block, GlobalConfig } from "payload";

import { admins } from "@/access/roles";
import { groups } from "@/collections/groups";

const HeroBlock: Block = {
    slug: "hero",
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
            name: "ctaButtonText",
            type: "text",
            label: "CTA Button Text",
        },
        {
            name: "ctaButtonLink",
            type: "text",
            label: "CTA Button Link",
        },
        {
            name: "backgroundImage",
            type: "upload",
            relationTo: "media",
        },
    ],
};

const CarouselBlock: Block = {
    slug: "carousel",
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
            name: "featuredProducts",
            type: "upload",
            hasMany: true,
            relationTo: "media",
        },
        {
            name: "backgroundImage",
            type: "upload",
            relationTo: "media",
        },
    ],
};

export const HeroSection: GlobalConfig = {
    slug: "hero-section",
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
            blocks: [HeroBlock, CarouselBlock],
            maxRows: 1,
            required: true,
        },
    ],
};
