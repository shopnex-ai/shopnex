import { getLocale } from "next-intl/server";
import { getPayload } from "payload";

import config from "@payload-config";
export async function GET(req: Request) {
  const payload = await getPayload({ config });
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return Response.json({ message: "Verification token is required" }, { status: 400 });
    }

    await payload.verifyEmail({
      collection: "customers",
      token: token,
    });

    const locale = await getLocale();

    return Response.redirect(`${process.env.NEXT_PUBLIC_SERVER_URL}/${locale}/login?verified=true`);
  } catch (error) {
    console.log(error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
