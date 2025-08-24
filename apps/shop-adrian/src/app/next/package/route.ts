import { isAxiosError } from "axios";
import { headers as getHeaders } from "next/headers";
import { getLocale } from "next-intl/server";
import { getPayload } from "payload";

const createCouriers = async (locale: Locale) => {
  const couriersModule = await import("@/globals/(ecommerce)/Couriers/utils/couriersConfig");
  return couriersModule.createCouriers(locale);
};
import { type Locale } from "@/i18n/config";
import config from "@payload-config";

export type Dimensions = { width: number; height: number; length: number; weight: number };

export async function POST(req: Request) {
  try {
    const payload = await getPayload({ config });
    /**
     * dimension - for inpost-pickup, string (small, medium, large). Exact dimensions not needed there.
     * dimensions - for inpost-courier, object { width: number, height: number, length: number, weight: number }
     */
    const {
      orderID,
      dimension,
      dimensions,
    }: {
      orderID: string;
      dimension: string;
      dimensions: Dimensions;
    } = (await req.json()) as {
      orderID: string;
      dimension: string;
      dimensions: Dimensions;
    };

    if (!orderID) {
      return Response.json("Cannot find order ID", { status: 400 });
    }

    const headers = await getHeaders();
    const { user } = await payload.auth({ headers });

    const locale = (await getLocale()) as Locale;

    if (!user || user?.collection !== "administrators") {
      return Response.json("Unauthorized", { status: 401 });
    }

    const order = await payload.findByID({
      collection: "orders",
      id: orderID,
    });

    if (!order) {
      return Response.json("Cannot find order", { status: 400 });
    }

    const courier = (await createCouriers(locale)).find((c) => c.key === order.orderDetails?.shipping);
    const packageID = courier ? await courier.createPackage(order, dimension, dimensions) : null;

    if (!packageID) {
      return Response.json("Cannot create package", { status: 400 });
    }

    return Response.json(`${packageID}`, { status: 200 });
  } catch (error) {
    if (isAxiosError(error)) {
      console.log();
      const typedError = error?.response?.data as { message: string; details: Record<string, unknown> };
      return Response.json(
        `${typedError.message} \n
        Error details: ${JSON.stringify(typedError.details)}`,
        { status: 400 },
      );
    } else {
      console.log(error);
      return Response.json("No file found", { status: 400 });
    }
  }
}
