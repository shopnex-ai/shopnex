import type { PayloadRequest } from "payload";

export const getClientIp = (req: PayloadRequest) => {
    return (
        req.headers.get("cf-connecting-ip") ||
        req.headers.get("x-real-ip") ||
        req.headers.get("x-forwarded-for")
    );
};
