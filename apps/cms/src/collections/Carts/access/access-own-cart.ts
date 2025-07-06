import { checkRole } from "@/access/roles";
import { parseCookies } from "payload";

export const canAccessOwnCart = ({ req }: any) => {
    if (req.user) {
        if (checkRole(["admin"], req.user)) {
            return true;
        }
    }
    const cookies = parseCookies(req.headers);

    const cardId = cookies.get("cart-session");
    if (!cardId) {
        return {
            id: {
                equals: null,
            },
        };
    }

    return {
        id: {
            equals: cardId,
        },
    };
};
