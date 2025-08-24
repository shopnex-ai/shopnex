import { setRequestLocale } from "next-intl/server";

import { Settings } from "@/globals/(ecommerce)/Layout/ClientPanel/Settings";
import { type Locale } from "@/i18n/config";
import { getCustomer } from "@/utilities/getCustomer";

const SettingsPage = async ({ params }: { params: Promise<{ locale: Locale }> }) => {
  const user = await getCustomer();
  const { locale } = await params;
  setRequestLocale(locale);
  if (!user) return null;
  return <Settings user={user} />;
};
export default SettingsPage;
