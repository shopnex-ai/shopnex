import { getPayload } from "payload";

import { type Locale } from "@/i18n/config";
import { getFilledProducts } from "@/lib/getFilledProducts";
import { getTotal } from "@/lib/getTotal";
import { type Cart } from "@/stores/CartStore/types";
import config from "@payload-config";

export async function POST(req: Request) {
  try {
    const payload = await getPayload({ config });
    const { cart, locale }: { cart: Cart | undefined; locale: Locale } = (await req.json()) as {
      cart: Cart | undefined;
      locale: Locale;
    };
    if (!cart) {
      return Response.json({ status: 200 });
    }

    const { docs: products } = await payload.find({
      collection: "products",
      where: {
        id: {
          in: cart.map((product) => product.id),
        },
      },
      locale,
      select: {
        title: true,
        price: true,
        images: true,
        variants: true,
        enableVariants: true,
        enableVariantPrices: true,
        colors: true,
        slug: true,
        stock: true,
        sizes: true,
        pricing: true,
      },
    });

    const filledProducts = getFilledProducts(products, cart);

    const total = getTotal(filledProducts);

    const productsWithTotal = {
      filledProducts,
      total,
      totalQuantity: filledProducts.reduce((acc, product) => acc + (product?.quantity ?? 0), 0),
    };

    return Response.json({ status: 200, productsWithTotal });
  } catch (error) {
    console.log(error);
    return Response.json({ status: 500, message: "Internal server error" });
  }
}
