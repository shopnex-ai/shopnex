import type { AfterChangeHook } from "@/admin/types";
import type { Cart } from "@/payload-types";

import { generateCookie, getCookieExpiration, mergeHeaders } from "payload";

export const sessionCartCreate: AfterChangeHook<Cart> = ({
    doc,
    operation,
    req,
}) => {
    if (operation !== "create") {
        return;
    }

    const cartCookie = generateCookie({
        name: "cart-session",
        expires: getCookieExpiration({ seconds: 60 * 60 * 24 * 30 }),
        path: "/",
        returnCookieAsObject: false,
        value: doc.sessionId!,
    });

    const newHeaders = new Headers({
        "Set-Cookie": cartCookie as string,
    });

    req.responseHeaders = req.responseHeaders
        ? mergeHeaders(req.responseHeaders, newHeaders)
        : newHeaders;
};
