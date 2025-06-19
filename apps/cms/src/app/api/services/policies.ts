import type { BasePayload } from "payload";

const policiesList = [
    {
        handle: "privacy-policy",
        title: "Privacy Policy",
    },
    {
        handle: "terms-of-service",
        title: "Terms of Service",
    },
    {
        handle: "shipping-policy",
        title: "Shipping Policy",
    },
    {
        handle: "returns-policy",
        title: "Returns Policy",
    },
];

const createIfNotExists = async (payload: BasePayload, policy: any) => {
    const count = await payload.count({
        collection: "policies",
        where: {
            handle: {
                equals: policy.handle,
            },
        },
    });

    if (count.totalDocs === 0) {
        await payload.create({
            collection: "policies",
            data: policy,
        });
    }
};

export const populatePolicies = async (payload: BasePayload) => {
    for (const policy of policiesList) {
        await createIfNotExists(payload, policy);
    }
};
