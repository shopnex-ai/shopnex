import { getPayload } from "payload";

import { type Locale } from "@/i18n/config";
import { getFilledProducts } from "@/lib/getFilledProducts";
import { type WishList } from "@/stores/WishlistStore/types";
import config from "@payload-config";

export async function POST(req: Request) {
  try {
    const payload = await getPayload({ config });
    const { wishlist, locale }: { wishlist: WishList | undefined; locale: Locale } = (await req.json()) as {
      wishlist: WishList | undefined;
      locale: Locale;
    };
    if (!wishlist) {
      return Response.json({ status: 200 });
    }

    const { docs: products } = await payload.find({
      collection: "products",
      where: {
        id: {
          in: wishlist.map((product) => product.id),
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
        sizes: true,
        pricing: true,
      },
    });

    const filledProducts = getFilledProducts(products, wishlist);

    return Response.json({ status: 200, filledProducts });
  } catch (error) {
    console.log(error);
    return Response.json({ status: 500, message: "Internal server error" });
  }
}
