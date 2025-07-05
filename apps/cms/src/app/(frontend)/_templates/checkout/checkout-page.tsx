"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { Card, CardContent } from "../../_components/ui/card";
import { AddressForm } from "./address-form";
import { DeliveryForm } from "./delivery-form";
import { OrderSummery } from "./order-summary";
import { PaymentForm } from "./payment-form";
import { Review } from "./review";

interface CheckoutData {
    delivery: {
        method: string;
    };
    payment: {
        cardNumber: string;
        cvc: string;
        expiryMonth: string;
        expiryYear: string;
        nameOnCard: string;
    };
    shipping: {
        address: string;
        billingAddressSame: boolean;
        city: string;
        company: string;
        country: string;
        email: string;
        firstName: string;
        lastName: string;
        phone: string;
        postalCode: string;
        state: string;
    };
}

const steps = [
    {
        id: 1,
        name: "Shipping Address",
        description: "Enter your shipping details",
    },
    { id: 2, name: "Delivery", description: "Choose delivery method" },
    { id: 3, name: "Payment", description: "Enter payment details" },
    { id: 4, name: "Review", description: "Review your order" },
];

export default function CheckoutPage() {
    const [currentStep, setCurrentStep] = useState(1);
    const [checkoutData, setCheckoutData] = useState<CheckoutData>({
        delivery: {
            method: "standard",
        },
        payment: {
            cardNumber: "",
            cvc: "",
            expiryMonth: "",
            expiryYear: "",
            nameOnCard: "",
        },
        shipping: {
            address: "",
            billingAddressSame: true,
            city: "",
            company: "",
            country: "",
            email: "",
            firstName: "",
            lastName: "",
            phone: "",
            postalCode: "",
            state: "",
        },
    });

    const updateShippingData = (field: string, value: boolean | string) => {
        setCheckoutData((prev) => ({
            ...prev,
            shipping: {
                ...prev.shipping,
                [field]: value,
            },
        }));
    };

    const updateDeliveryData = (field: string, value: string) => {
        setCheckoutData((prev) => ({
            ...prev,
            delivery: {
                ...prev.delivery,
                [field]: value,
            },
        }));
    };

    const updatePaymentData = (field: string, value: string) => {
        setCheckoutData((prev) => ({
            ...prev,
            payment: {
                ...prev.payment,
                [field]: value,
            },
        }));
    };

    const nextStep = () => {
        if (currentStep < 4) {
            setCurrentStep(currentStep + 1);
        }
    };

    const prevStep = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 1:
                return (
                    <AddressForm
                        checkoutData={checkoutData}
                        nextStep={nextStep}
                        updateShippingData={updateShippingData}
                    />
                );

            case 2:
                return (
                    <DeliveryForm
                        checkoutData={checkoutData}
                        nextStep={nextStep}
                        prevStep={prevStep}
                        updateDeliveryData={updateDeliveryData}
                    />
                );

            case 3:
                return (
                    <PaymentForm
                        checkoutData={checkoutData}
                        nextStep={nextStep}
                        prevStep={prevStep}
                        updatePaymentData={updatePaymentData}
                    />
                );

            case 4:
                return (
                    <Review checkoutData={checkoutData} prevStep={prevStep} />
                );

            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2">
                        {/* Progress Steps */}
                        <div className="mb-8">
                            <div className="flex items-center justify-between">
                                {steps.map((step, index) => (
                                    <div
                                        className="flex items-center"
                                        key={step.id}
                                    >
                                        <div
                                            className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
                                                currentStep >= step.id
                                                    ? "bg-black border-black text-white"
                                                    : currentStep === step.id
                                                      ? "border-black text-black"
                                                      : "border-gray-300 text-gray-300"
                                            }`}
                                        >
                                            {currentStep > step.id ? (
                                                <Check className="w-4 h-4" />
                                            ) : (
                                                <span className="text-sm font-medium">
                                                    {step.id}
                                                </span>
                                            )}
                                        </div>
                                        <div className="ml-3">
                                            <p
                                                className={`text-sm font-medium ${currentStep >= step.id ? "text-black" : "text-gray-500"}`}
                                            >
                                                {step.name}
                                            </p>
                                        </div>
                                        {index < steps.length - 1 && (
                                            <div
                                                className={`hidden sm:block w-16 h-0.5 ml-4 ${
                                                    currentStep > step.id
                                                        ? "bg-black"
                                                        : "bg-gray-300"
                                                }`}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Step Content */}
                        <Card>
                            <CardContent className="p-6">
                                {renderStepContent()}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Order Summary */}
                    <OrderSummery checkoutData={checkoutData} />
                </div>
            </div>
        </div>
    );
}
