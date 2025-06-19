export const checkCredentials = () => {
    if (!process.env.PAYLOAD_SECRET) {
        throw new Error("PAYLOAD_SECRET is required");
    }
};
