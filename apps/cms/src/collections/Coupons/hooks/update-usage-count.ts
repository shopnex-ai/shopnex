import type { CollectionAfterChangeHook } from "payload";

export const updateCouponUsageCount: CollectionAfterChangeHook = async ({
    doc,
    req,
    previousDoc,
    operation,
}) => {
    if (operation === "update" && doc.collection === "orders") {
        const { payload } = req;

        // Check if order status changed to paid and there's a coupon
        const couponCode = doc.metadata?.couponCode;

        if (
            couponCode &&
            doc.paymentStatus === "paid" &&
            previousDoc?.paymentStatus !== "paid"
        ) {
            try {
                // Find and update coupon usage count
                const coupons = await payload.find({
                    collection: "coupons",
                    where: {
                        code: {
                            equals: couponCode,
                        },
                    },
                    limit: 1,
                });

                if (coupons.docs.length > 0) {
                    const coupon = coupons.docs[0];
                    await payload.update({
                        collection: "coupons",
                        id: coupon.id,
                        data: {
                            usageCount: (coupon.usageCount || 0) + 1,
                        },
                    });
                }
            } catch (error) {
                console.error("Error updating coupon usage count:", error);
            }
        }
    }

    return doc;
};
