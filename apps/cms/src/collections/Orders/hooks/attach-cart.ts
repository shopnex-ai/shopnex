import type { BeforeChangeHook } from "@/admin/types";
import type { Order } from "@shopnex/types";

import { parseCookies } from "payload";

export const attachCart: BeforeChangeHook<Order> = async ({ data, req }) => {
    if (data.cart) {
        return;
    }

    const cookies = parseCookies(req.headers);
    const cartSessionId = cookies.get("cart-session");

    const cart = await req.payload.find({
        collection: "carts",
        where: {
            sessionId: {
                equals: cartSessionId,
            },
        },
    });

    if (!cart) {
        return;
    }

    data.cart = cart.docs[0].id;
};
