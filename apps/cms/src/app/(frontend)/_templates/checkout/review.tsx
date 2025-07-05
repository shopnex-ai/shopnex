import { payloadSdk } from "@/utils/payload-sdk";
import { Button } from "@medusajs/ui";
import { useState } from "react";
import { useCart } from "react-use-cart";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "../../_components/ui/card";

interface ReviewProps {
    checkoutData: any;
    prevStep: () => void;
}

export const Review = ({ checkoutData, prevStep }: ReviewProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const { items } = useCart();

    const handleCompleteOrder = async () => {
        setIsLoading(true);
        try {
            // Create order data
            const orderData = {
                cartItems: items,
                // customer: {
                //     email: checkoutData.shipping.email,
                //     firstName: checkoutData.shipping.firstName,
                //     lastName: checkoutData.shipping.lastName,
                //     phone: checkoutData.shipping.phone,
                // },
                paymentMethod: checkoutData.payment.methodType,
                shippingAddress: {
                    address: checkoutData.shipping.address,
                    city: checkoutData.shipping.city,
                    company: checkoutData.shipping.company,
                    country: checkoutData.shipping.country,
                    postalCode: checkoutData.shipping.postalCode,
                    state: checkoutData.shipping.state,
                },
                shippingMethod: checkoutData.delivery.method,
            };

            console.log("Order data to be sent to API:", orderData);

            const fetchResult = await fetch("/api/orders/checkout", {
                body: JSON.stringify(orderData),
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                },
                method: "POST",
            });

            if (!fetchResult.ok) {
                throw new Error("Failed to create order");
            }

            const result = await fetchResult.json();
            window.location.href = result.redirectUrl;
        } catch (error) {
            console.error("Error completing order:", error);
            alert("Error completing order. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-semibold mb-6">Review</h2>
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">
                                Shipping Address
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm space-y-1">
                                <p>
                                    {checkoutData.shipping.firstName}{" "}
                                    {checkoutData.shipping.lastName}
                                </p>
                                <p>{checkoutData.shipping.address}</p>
                                <p>
                                    {checkoutData.shipping.city},{" "}
                                    {checkoutData.shipping.state}{" "}
                                    {checkoutData.shipping.postalCode}
                                </p>
                                <p>{checkoutData.shipping.country}</p>
                                <p>{checkoutData.shipping.email}</p>
                                {checkoutData.shipping.phone && (
                                    <p>{checkoutData.shipping.phone}</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">
                                Delivery Method
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm">
                                {checkoutData.delivery.method === "standard" &&
                                    "Standard Delivery (5-7 business days) - Free"}
                                {checkoutData.delivery.method === "express" &&
                                    "Express Delivery (2-3 business days) - $15.00"}
                                {checkoutData.delivery.method === "overnight" &&
                                    "Overnight Delivery (Next business day) - $25.00"}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">
                                Payment Method
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm space-y-2">
                                <p>
                                    {checkoutData.payment?.methodLabel ||
                                        checkoutData.payment?.method}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {checkoutData.payment?.methodInstructions && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">
                                    Payment Instructions
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="prose prose-sm max-w-none">
                                    <div
                                        className="text-sm text-gray-700 whitespace-pre-line"
                                        dangerouslySetInnerHTML={{
                                            __html: checkoutData.payment
                                                .methodInstructions,
                                        }}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
            <div className="flex space-x-4">
                <Button
                    disabled={isLoading}
                    onClick={prevStep}
                    variant="secondary"
                >
                    Back to payment
                </Button>
                <Button disabled={isLoading} onClick={handleCompleteOrder}>
                    {isLoading ? "Processing..." : "Complete order"}
                </Button>
            </div>
        </div>
    );
};
