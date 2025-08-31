import type { Endpoint } from "payload";

export const validateCouponEndpoint: Endpoint = {
    path: "/validate-coupon",
    method: "post",
    handler: async (req) => {
        const { payload } = req;
        const { code, cartTotal, cartItems, userId } = req.json?.() as any;

        if (!code) {
            return Response.json(
                { success: false, error: "Coupon code is required" },
                { status: 400 }
            );
        }

        try {
            // Find coupon by code
            const coupons = await payload.find({
                collection: "coupons",
                where: {
                    code: {
                        equals: code.toUpperCase().replace(/\s+/g, ""),
                    },
                },
                limit: 1,
            });

            if (!coupons.docs.length) {
                return Response.json(
                    { success: false, error: "Invalid coupon code" },
                    { status: 404 }
                );
            }

            const coupon = coupons.docs[0];

            // Check if coupon is active
            if (!coupon.active) {
                return Response.json(
                    {
                        success: false,
                        error: "This coupon is no longer active",
                    },
                    { status: 400 }
                );
            }

            // Check start date
            if (coupon.startsAt && new Date(coupon.startsAt) > new Date()) {
                return Response.json(
                    {
                        success: false,
                        error: "This coupon is not yet available",
                    },
                    { status: 400 }
                );
            }

            // Check expiry date
            if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
                return Response.json(
                    { success: false, error: "This coupon has expired" },
                    { status: 400 }
                );
            }

            // Check usage limit
            if (
                coupon.usageLimit &&
                (coupon.usageCount || 0) >= coupon.usageLimit
            ) {
                return Response.json(
                    {
                        success: false,
                        error: "This coupon has reached its usage limit",
                    },
                    { status: 400 }
                );
            }

            // Check minimum order amount
            if (
                coupon.minimumOrderAmount &&
                cartTotal < coupon.minimumOrderAmount
            ) {
                return Response.json(
                    {
                        success: false,
                        error: `Minimum order amount of ${coupon.minimumOrderAmount} required`,
                    },
                    { status: 400 }
                );
            }

            // Check usage limit per customer
            if (coupon.usageLimitPerCustomer && userId) {
                const customerOrders = await payload.find({
                    collection: "orders",
                    where: {
                        and: [
                            { user: { equals: userId } },
                            { "metadata.couponCode": { equals: code } },
                        ],
                    },
                });

                if (customerOrders.totalDocs >= coupon.usageLimitPerCustomer) {
                    return Response.json(
                        {
                            success: false,
                            error: "You have reached the usage limit for this coupon",
                        },
                        { status: 400 }
                    );
                }
            }

            // Calculate discount amount
            let discountAmount = 0;

            if (coupon.discountType === "percentage") {
                discountAmount = (cartTotal * coupon.discountValue) / 100;

                // Apply maximum discount amount if set
                if (
                    coupon.maximumDiscountAmount &&
                    discountAmount > coupon.maximumDiscountAmount
                ) {
                    discountAmount = coupon.maximumDiscountAmount;
                }
            } else if (coupon.discountType === "fixed") {
                discountAmount = coupon.discountValue;

                // Don't allow discount to exceed cart total
                if (discountAmount > cartTotal) {
                    discountAmount = cartTotal;
                }
            } else if (coupon.discountType === "free_shipping") {
                discountAmount = 0; // Shipping discount handled separately
            }

            return Response.json({
                success: true,
                coupon: {
                    id: coupon.id,
                    code: coupon.code,
                    discountType: coupon.discountType,
                    discountValue: coupon.discountValue,
                    discountAmount,
                },
            });
        } catch (error) {
            console.error("Error validating coupon:", error);
            return Response.json(
                { success: false, error: "Internal server error" },
                { status: 500 }
            );
        }
    },
};
