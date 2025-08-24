import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { redirect } from "@/i18n/routing";

const ResetPassword = async ({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; collection: string }>;
}) => {
  const { token, collection } = await searchParams;
  const { locale } = await params;
  if (!token) {
    return redirect({ href: "/", locale });
  }
  return <ResetPasswordForm token={token} collection={collection ?? "administrators"} />;
};
export default ResetPassword;
