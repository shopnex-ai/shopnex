import { listCartPaymentMethods } from "@/app/api/services/payment";
import _ from "lodash";

import { BuilderPage } from "../components/BuilderPage";

export const dynamic = "force-dynamic";

const CheckoutPage = async () => {
    const payments = await listCartPaymentMethods();
    const enabledPayment = payments.docs.find((doc: any) => doc.enabled);
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
