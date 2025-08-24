import { revalidateTag } from "next/cache";
import { setRequestLocale } from "next-intl/server";

import { OrdersData } from "@/globals/(ecommerce)/Layout/ClientPanel/OrdersData/Component";
import { type Locale } from "@/i18n/config";
import { getCustomer } from "@/utilities/getCustomer";

async function updateCustomerData() {
  "use server";
  revalidateTag("user-auth");
}

const OrdersDataPage = async ({ params }: { params: Promise<{ locale: Locale }> }) => {
  const user = await getCustomer();
  const { locale } = await params;
  setRequestLocale(locale);
  if (!user) return null;
  return <OrdersData user={user} updateCustomerData={updateCustomerData} />;
};
export default OrdersDataPage;
