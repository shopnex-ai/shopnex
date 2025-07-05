import { Button, Label } from "@medusajs/ui";

import Checkbox from "../../_components/checkbox";
import { Input } from "../../_components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../_components/ui/select";

export const AddressForm = ({
    checkoutData,
    nextStep,
    updateShippingData,
}: any) => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-semibold mb-6">
                    Shipping Address
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Input
                            autoComplete="given-name"
                            data-testid="shipping-first-name-input"
                            label="First name"
                            name="shipping_address.first_name"
                            onChange={(e) =>
                                updateShippingData("firstName", e.target.value)
                            }
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="lastName"
                            label="Last name*"
                            name="shipping_address.last_name"
                            onChange={(e) =>
                                updateShippingData("lastName", e.target.value)
                            }
                            value={checkoutData.shipping.lastName}
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="address"
                            label="Address*"
                            name="shipping_address.address_1"
                            onChange={(e) =>
                                updateShippingData("address", e.target.value)
                            }
                            value={checkoutData.shipping.address}
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="company"
                            label="Company"
                            name="shipping_address.company"
                            onChange={(e) =>
                                updateShippingData("company", e.target.value)
                            }
                            value={checkoutData.shipping.company}
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="postalCode"
                            label="Postal code*"
                            name="shipping_address.postal_code"
                            onChange={(e) =>
                                updateShippingData("postalCode", e.target.value)
                            }
                            value={checkoutData.shipping.postalCode}
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="city"
                            label="City*"
                            name="shipping_address.city"
                            onChange={(e) =>
                                updateShippingData("city", e.target.value)
                            }
                            value={checkoutData.shipping.city}
                        />
                    </div>
                    <div className="space-y-2">
                        <Select
                            onValueChange={(value) =>
                                updateShippingData("country", value)
                            }
                            value={checkoutData.shipping.country}
                        >
                            <SelectTrigger className="bg-gray-50">
                                <SelectValue placeholder="Country" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="us">
                                    United States
                                </SelectItem>
                                <SelectItem value="ca">Canada</SelectItem>
                                <SelectItem value="uk">
                                    United Kingdom
                                </SelectItem>
                                <SelectItem value="au">Australia</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="state"
                            label="State / Province"
                            name="shipping_address.province"
                            onChange={(e) =>
                                updateShippingData("state", e.target.value)
                            }
                            value={checkoutData.shipping.state}
                        />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                checked={
                                    checkoutData.shipping.billingAddressSame
                                }
                                id="billingAddressSame"
                                onCheckedChange={(checked: any) =>
                                    updateShippingData(
                                        "billingAddressSame",
                                        checked as boolean
                                    )
                                }
                            />
                            <Label htmlFor="billingAddressSame">
                                Billing address same as shipping address
                            </Label>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="email"
                            label="Email*"
                            name="email"
                            onChange={(e) =>
                                updateShippingData("email", e.target.value)
                            }
                            type="email"
                            value={checkoutData.shipping.email}
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            autoComplete="tel"
                            data-testid="shipping-phone-input"
                            id="phone"
                            label="Phone"
                            name="shipping_address.phone"
                            onChange={(e) =>
                                updateShippingData("phone", e.target.value)
                            }
                            value={checkoutData.shipping.phone}
                        />
                    </div>
                </div>
            </div>
            <Button onClick={nextStep}>Continue to delivery</Button>
        </div>
    );
};
