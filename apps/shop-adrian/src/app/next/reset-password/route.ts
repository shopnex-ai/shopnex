import { randomBytes } from "crypto";

import { render } from "@react-email/components";
import { getLocale, getTranslations } from "next-intl/server";
import { getPayload } from "payload";

import { ResetPasswordEmail } from "@/components/Emails/ResetPasswordEmail";
import { type Locale } from "@/i18n/config";
import { type Customer, type Administrator } from "@/payload-types";
import { sendEmail } from "@/utilities/nodemailer";
import config from "@payload-config";

const isCustomer = (user: Administrator | Customer): user is Customer => {
  return !(user as Administrator).name;
};

export async function POST(req: Request) {
  const payload = await getPayload({ config });
  try {
    const body = (await req.json()) as { email: string; collection: "administrators" | "customers" };
    const email = body.email;
    const collection: "administrators" | "customers" = body.collection;
    const token: string = randomBytes(20).toString("hex");

    const { docs } = await payload.find({
      collection: collection,
      where: {
        email: {
          equals: email,
        },
      },
    });

    if (!docs || docs.length === 0) {
      return Response.json({ message: "Success" }, { status: 200 });
    }

    let user: Administrator | Customer = docs[0];

    user.resetPasswordToken = token;
    user.resetPasswordExpiration = new Date(Date.now() + 3600000).toISOString();

    user = await payload.update({
      collection: collection,
      id: user.id,
      data: user,
    });

    const locale = (await getLocale()) as Locale;

    let name = "User";
    if (isCustomer(user) && user.firstName) {
      name = user.firstName;
    } else if (!isCustomer(user) && user.name) {
      name = user.name;
    }

    const html = await render(
      await ResetPasswordEmail({
        url: `${process.env.NEXT_PUBLIC_SERVER_URL}/${locale}/reset-password?token=${token}&collection=${collection}`,
        locale,
        name,
      }),
    );

    const t = await getTranslations({ locale, namespace: "Emails.reset-password" });

    const res = await sendEmail({ to: email, subject: t("subject"), html });
    console.log(res);
  } catch (error) {
    console.log(error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
  return Response.json({ message: "Success" }, { status: 200 });
}
