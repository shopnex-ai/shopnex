import { payloadSdk } from "@/utils/payload-sdk";
import { Button, Label } from "@medusajs/ui";
import { useEffect, useState } from "react";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "../../_components/ui/card";
import { RadioGroup, RadioGroupItem } from "../../_components/ui/radio-group";

interface PaymentMethod {
    details?: string;
    id: string;
    instructions?: string;
    label: string;
    type: string;
}

interface PaymentFormProps {
    checkoutData: any;
    nextStep: () => void;
    prevStep: () => void;
    updatePaymentData: (field: string, value: string) => void;
}

export const PaymentForm = ({
    checkoutData,
    nextStep,
    prevStep,
    updatePaymentData,
}: PaymentFormProps) => {
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(
        checkoutData.payment?.method || ""
    );

    useEffect(() => {
        const fetchPaymentMethods = async () => {
            const data = await payloadSdk.find({
                collection: "payments",
                where: { enabled: { equals: true } },
            });

            const methods: PaymentMethod[] = data.docs.flatMap(
                (doc) =>
                    doc.providers?.map((provider: any) => ({
                        id: provider.id,
                        type: provider.blockType,
                        details: provider.details,
                        instructions: provider.instructions,
                        label: provider.providerName || provider.methodType,
                    })) || []
            );

            setPaymentMethods(methods);
            if (!checkoutData.payment?.method && methods.length > 0) {
                setSelectedPaymentMethod(methods[0].id);

                updatePaymentData("method", methods[0].label);
                updatePaymentData("methodType", methods[0].type);
                updatePaymentData(
                    "methodInstructions",
                    methods[0]?.instructions || ""
                );
            }
        };

        fetchPaymentMethods();
    }, []);

    const getSelectedMethodDetails = () => {
        const selectedMethod = paymentMethods.find(
            (method) => method.id === selectedPaymentMethod
        );
        return selectedMethod;
    };

    const renderPaymentOptions = () => {
        return paymentMethods.map((method) => (
            <div
                className="flex items-center space-x-3 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                key={method.id}
            >
                <RadioGroupItem id={method.id} value={method.id} />
                <Label className="flex-1 cursor-pointer" htmlFor={method.id}>
                    <div>
                        <div className="font-medium">{method.label}</div>
                        {method.details && (
                            <div className="text-sm text-gray-600 mt-1">
                                {method.details}
                            </div>
                        )}
                    </div>
                </Label>
            </div>
        ));
    };

    const selectedMethodDetails = getSelectedMethodDetails();

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-semibold mb-6">Payment</h2>

            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Select Payment Method</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <RadioGroup
                            onValueChange={(value) => {
                                setSelectedPaymentMethod(value);
                                const selectedMethod = paymentMethods.find(
                                    (m) => m.id === value
                                );
                                debugger;
                                updatePaymentData(
                                    "method",
                                    selectedMethod?.label || ""
                                );
                                updatePaymentData(
                                    "methodType",
                                    selectedMethod?.type || ""
                                );
                                updatePaymentData(
                                    "methodLabel",
                                    selectedMethod?.label || ""
                                );
                                updatePaymentData(
                                    "methodDetails",
                                    selectedMethod?.details || ""
                                );
                                updatePaymentData(
                                    "methodInstructions",
                                    selectedMethod?.instructions || ""
                                );
                            }}
                            value={selectedPaymentMethod ?? ""}
                        >
                            <div className="space-y-4">
                                {renderPaymentOptions()}
                            </div>
                        </RadioGroup>
                    </CardContent>
                </Card>

                {selectedMethodDetails?.instructions && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Payment Instructions</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="prose prose-sm max-w-none">
                                <div className="text-sm text-gray-700 whitespace-pre-line">
                                    {selectedMethodDetails.instructions}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            <div className="flex space-x-4">
                <Button onClick={prevStep} variant="secondary">
                    Back to delivery
                </Button>
                <Button disabled={!selectedPaymentMethod} onClick={nextStep}>
                    Review order
                </Button>
            </div>
        </div>
    );
};
