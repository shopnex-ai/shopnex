import { anyone, checkRole } from "@/access/roles";
import {
    type CollectionConfig,
    generateCookie,
    getCookieExpiration,
    mergeHeaders,
    parseCookies,
} from "payload";

import { groups } from "./groups";

const canAccessOwnCart = ({ req }: any) => {
    const cookies = parseCookies(req.headers);

    if (req.user) {
        if (checkRole(["admin"], req.user)) {
            return true;
        }
    }

    const sessionId = cookies.get("cart-session");
    if (!sessionId) {
        return {
            sessionId: {
                equals: null,
            },
        };
    }

    return {
        sessionId: {
            equals: sessionId,
        },
    };
};

export const Carts: CollectionConfig = {
    slug: "carts",
    access: {
        create: anyone,
        delete: canAccessOwnCart,
        read: canAccessOwnCart,
        update: canAccessOwnCart,
    },
    admin: {
        group: groups.customers,
        useAsTitle: "id",
    },
    fields: [
        {
            name: "sessionId",
            type: "text",
            admin: {
                position: "sidebar",
                readOnly: true,
            },
            required: true,
        },
        {
            name: "cartItems",
            type: "array",
            fields: [
                {
                    name: "product",
                    type: "relationship",
                    relationTo: "products",
                    required: true,
                },
                {
                    name: "quantity",
                    type: "number",
                    required: true,
                },
            ],
        },
    ],
    hooks: {
        afterChange: [
            ({ doc, operation, req }) => {
                if (operation !== "create") {
                    return;
                }

                const tenantCookie = generateCookie({
                    name: "cart-session",
                    expires: getCookieExpiration({ seconds: 7200 }),
                    path: "/",
                    returnCookieAsObject: false,
                    value: doc.sessionId,
                });

                const newHeaders = new Headers({
                    "Set-Cookie": tenantCookie as string,
                });

                req.responseHeaders = req.responseHeaders
                    ? mergeHeaders(req.responseHeaders, newHeaders)
                    : newHeaders;
            },
        ],
        beforeValidate: [
            ({ data, operation }) => {
                if (operation !== "create" || !data) {
                    return;
                }
                const sessionId = crypto.randomUUID();

                data.sessionId = sessionId;
            },
        ],
    },
};
