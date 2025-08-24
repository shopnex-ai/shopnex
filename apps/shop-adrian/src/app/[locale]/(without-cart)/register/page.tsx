import { RegisterPageWithoutOAuth } from "@/components/(ecommerce)/RegisterPage/WithoutOAuth";
import { type Locale } from "@/i18n/config";
import { redirect } from "@/i18n/routing";
import { getCustomer } from "@/utilities/getCustomer";
import { getCachedGlobal } from "@/utilities/getGlobals";

const RegisterPage = async ({ params }: { params: Promise<{ locale: Locale }> }) => {
  const user = await getCustomer();
  const { locale } = await params;
  if (user) {
    return redirect({ locale: locale, href: "/account" });
  }
  const shopSettings = await getCachedGlobal("shopSettings", locale, 1)();

  return shopSettings.enableOAuth ? <></> : <RegisterPageWithoutOAuth />;
};

export default RegisterPage;
