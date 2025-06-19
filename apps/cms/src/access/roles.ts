import type { User } from "@/payload-types";
import type { Access, AccessArgs } from "payload";

export const checkRole = (roles: User["roles"] = [], user?: null | User) =>
    !!user?.roles?.some((role) => roles?.includes(role));

type isAdmin = (args: AccessArgs<User>) => boolean;

export const admins: isAdmin = ({ req: { user } }) => {
    return checkRole(["admin"], user);
};

export const anyone: Access = () => {
    return true;
};

export const adminsOrSelf: Access = ({ req: { user } }) => {
    if (user) {
        if (checkRole(["admin"], user)) {
            return true;
        }

        return {
            id: {
                equals: user.id,
            },
        };
    }

    return false;
};
