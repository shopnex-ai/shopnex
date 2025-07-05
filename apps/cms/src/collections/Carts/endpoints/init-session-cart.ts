import type { Endpoint } from "payload";

import { generateCookie, getCookieExpiration, mergeHeaders } from "payload";

export const initSessionCart: Endpoint = {
    handler: async (req) => {
        const sessionId = crypto.randomUUID();
        const cart = await req.payload.create({
            collection: "carts",
            data: {
                cartItems: [],
                sessionId,
            },
        });
        const cartCookie = generateCookie({
            name: "cart-session",
            expires: getCookieExpiration({ seconds: 60 * 60 * 24 * 30 }),
            path: "/",
            returnCookieAsObject: false,
            value: sessionId,
        });

        const newHeaders = new Headers({
            "Set-Cookie": cartCookie as string,
        });

        req.responseHeaders = req.responseHeaders
            ? mergeHeaders(req.responseHeaders, newHeaders)
            : newHeaders;

        return Response.json({
            sessionId,
        });
    },
    method: "get",
    path: "/",
};
