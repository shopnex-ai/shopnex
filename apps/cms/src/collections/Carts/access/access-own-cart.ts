import { checkRole } from "@/access/roles";
import { parseCookies } from "payload";

export const canAccessOwnCart = ({ req }: any) => {
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
