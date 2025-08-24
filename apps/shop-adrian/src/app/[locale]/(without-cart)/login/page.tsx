import { LoginPageWithoutOAuth } from "@/components/(ecommerce)/LoginPage/WithoutOAuth";
import { type Locale } from "@/i18n/config";
import { redirect } from "@/i18n/routing";
import { getCustomer } from "@/utilities/getCustomer";
import { getCachedGlobal } from "@/utilities/getGlobals";

export const dynamic = "force-dynamic";

const LoginPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ verified?: string }>;
}) => {
  const user = await getCustomer();
  const { locale } = await params;
  const { verified } = await searchParams;
  if (user?.id) {
    return redirect({ locale: locale, href: "/account/orders" });
  }
  const shopSettings = await getCachedGlobal("shopSettings", locale, 1)();

  return shopSettings.enableOAuth ? <></> : <LoginPageWithoutOAuth verified={verified} />;
};
export default LoginPage;
