import { listCartPaymentMethods } from "@/app/api/services/payment";
import _ from "lodash";

import { BuilderPage } from "../lib/BuilderPage";

const CheckoutPage = async () => {
    const payments = await listCartPaymentMethods();
    const enabledPayment = payments.docs.find((doc) => doc.enabled);
    return (
        <BuilderPage
            data={{
                paymentProviders: enabledPayment?.providers,
            }}
            page={["checkout"]}
        />
    );
};

export default CheckoutPage;
