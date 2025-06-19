import type { CollectionConfig } from "payload";

import { admins } from "@/access/roles";
import { generateGiftCardCode } from "@/utils/generate-gift-card-code";
import { getClientIp } from "@/utils/get-client-ip";
import { RateLimiterMemory } from "rate-limiter-flexible";

import { groups } from "./groups";

const rateLimiter = new RateLimiterMemory({
    duration: 60,
    points: 5,
});

export const GiftCards: CollectionConfig = {
    slug: "gift-cards",
    access: {
        create: admins,
        delete: admins,
        read: admins,
        update: admins,
    },
    admin: {
        defaultColumns: ["code", "value", "expiryDate"],
        group: groups.catalog,
        useAsTitle: "code",
    },
    endpoints: [
        {
            handler: async (req) => {
                try {
                    const ip = getClientIp(req);

                    if (!ip) {
                        return Response.json({
                            message: "Missing IP address.",
                            statusCode: 400,
                        });
                    }

                    await rateLimiter.consume(ip, 1);

                    const giftCards = await req.payload.find({
                        collection: "gift-cards",
                        limit: 1,
                        where: {
                            code: {
                                equals: req.query.code,
                            },
                        },
                    });

                    return Response.json(giftCards.docs?.[0]);
                } catch (reject) {
                    return Response.json({
                        message: "Too many requests. Please try again later.",
                        statusCode: 429,
                    });
                }
            },
            method: "get",
            path: "/verify",
        },
    ],
    fields: [
        {
            name: "code",
            type: "text",
            defaultValue: () => {
                return generateGiftCardCode();
            },
            label: "Card code",
            required: true,
        },
        {
            name: "value",
            type: "number",
            label: "Initial value",
            required: true,
        },
        {
            name: "customer",
            type: "relationship",
            admin: {
                position: "sidebar",
            },
            label: "Customer",
            relationTo: "users",
        },
        {
            name: "expiryDate",
            type: "date",
            admin: {
                description: "Date gift card will expire",
            },
            label: "Expiration Date",
        },
    ],
};
