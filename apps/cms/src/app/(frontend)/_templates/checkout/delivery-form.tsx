import type { Shipping } from "@/payload-types";

import { payloadSdk } from "@/utils/payload-sdk";
import { Button, Label } from "@medusajs/ui";
import { Truck } from "lucide-react";
import { useEffect, useState } from "react";

import { RadioGroup, RadioGroupItem } from "../../_components/ui/radio-group";

export const DeliveryForm = ({
    checkoutData,
    nextStep,
    prevStep,
    updateDeliveryData,
}: any) => {
    const [deliveryMethods, setDeliveryMethods] = useState<Shipping[]>([]);
    const [selectedMethod, setSelectedMethod] = useState(
        checkoutData.delivery.method
    );

    useEffect(() => {
        const fetchDeliveryMethods = async () => {
            const data = await payloadSdk.find({
                collection: "shipping",
                where: {
                    enabled: {
                        equals: true,
                    },
                },
            });
            setDeliveryMethods(data.docs);
            if (
                data.docs.length > 0 &&
                data.docs[0].shippingProvider.length > 0
            ) {
                const defaultMethod = `${data.docs[0].id}:0`; // Assume the first provider in the first shipping method
                setSelectedMethod(defaultMethod);
                updateDeliveryData(
                    "cost",
                    data.docs[0].shippingProvider[0].baseRate
                );
            }
        };

        fetchDeliveryMethods();
    }, []);

    const renderShippingOptions = () => {
        return deliveryMethods.flatMap((method) => {
            if (!method.shippingProvider) {
                return [];
            }

            return method.shippingProvider.map(
                (providerBlock: any, idx: number) => {
                    const {
                        baseRate,
                        estimatedDeliveryDays,
                        freeShippingMinOrder,
                        label,
                        notes,
                    } = providerBlock;

                    const value = `${method.id}:${idx}`; // composite key to identify

                    return (
                        <div
                            className="flex items-center space-x-3 p-4 border rounded-lg"
                            key={value}
                        >
                            <RadioGroupItem id={value} value={value} />
                            <div className="flex-1">
                                <Label
                                    className="flex items-center justify-between cursor-pointer"
                                    htmlFor={value}
                                >
                                    <div className="flex items-center space-x-3">
                                        <Truck className="h-5 w-5" />
                                        <div>
                                            <div className="font-medium">
                                                {label}
                                            </div>
                                            {estimatedDeliveryDays && (
                                                <div className="text-sm text-gray-500">
                                                    {estimatedDeliveryDays}
                                                </div>
                                            )}
                                            {notes && (
                                                <div className="text-sm text-gray-400 italic">
                                                    {notes}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <span className="font-medium">
                                        {baseRate === 0
                                            ? "Free"
                                            : `$${baseRate.toFixed(2)}`}
                                    </span>
                                </Label>
                            </div>
                        </div>
                    );
                }
            );
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-semibold mb-6">Delivery</h2>
                <RadioGroup
                    onValueChange={(value) => {
                        setSelectedMethod(value);
                        const [shippingId, blockIndex] = value.split(":");
                        const shipping = deliveryMethods.find(
                            (m) => m.id === Number(shippingId)
                        );

                        const block =
                            shipping?.shippingProvider?.[Number(blockIndex)];

                        if (block?.baseRate !== undefined) {
                            updateDeliveryData("cost", block.baseRate);
                        }
                    }}
                    value={selectedMethod}
                >
                    <div className="space-y-4">{renderShippingOptions()}</div>
                </RadioGroup>
            </div>
            <div className="flex space-x-4">
                <Button onClick={prevStep} variant="secondary">
                    Back to shipping
                </Button>
                <Button onClick={nextStep}>Continue to payment</Button>
            </div>
        </div>
    );
};
