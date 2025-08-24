import { getPayload } from "payload";

import { type Country } from "@/globals/(ecommerce)/Couriers/utils/countryList";
import { type Locale } from "@/i18n/config";
import { getFilledProducts } from "@/lib/getFilledProducts";
import { getTotal } from "@/lib/getTotal";
import { getTotalWeight } from "@/lib/getTotalWeight";
import { type Cart } from "@/stores/CartStore/types";
import config from "@payload-config";

export async function POST(req: Request) {
  const { getCouriersArray } = await import("@/globals/(ecommerce)/Couriers/utils/couriersConfig");
  try {
    const payload = await getPayload({ config });
    const {
      cart,
      selectedCountry,
      locale,
    }: { cart: Cart | undefined; selectedCountry: Country; locale: Locale } = (await req.json()) as {
      cart: Cart | undefined;
      selectedCountry: Country;
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
        weight: true,
        pricing: true,
      },
    });

    const filledProducts = getFilledProducts(products, cart);

    const total = getTotal(filledProducts);

    const totalWeight = getTotalWeight(filledProducts, cart);

    const couriers = await getCouriersArray(locale, true);
    const filledCouriers = couriers
      .filter((courier) => courier?.deliveryZones?.find((zone) => zone.countries.includes(selectedCountry)))
      .map((courier) => {
        const deliveryZone = courier?.deliveryZones?.find((zone) => zone.countries.includes(selectedCountry));
        const deliveryZoneWithRange = {
          ...deliveryZone,
          range: deliveryZone?.range?.find(
            (range) => range.weightFrom <= totalWeight && range.weightTo >= totalWeight,
          ),
        };

        const calculatedPrice = deliveryZoneWithRange?.range?.pricing.map((prices) => {
          const freeShippingValue = deliveryZoneWithRange.freeShipping?.find(
            (freeShipping) => freeShipping.currency === prices.currency,
          )?.value;
          const totalPriceInCurrency = total.find((price) => price.currency === prices.currency)?.value;
          if (!freeShippingValue || !totalPriceInCurrency) {
            return prices;
          } else {
            return {
              ...prices,
              value: totalPriceInCurrency >= freeShippingValue ? 0 : prices.value,
            };
          }
        });

        if (courier) {
          return {
            slug: courier.slug,
            title: courier.title,
            turnaround: courier.turnaround,
            icon: courier.icon,
            pricing: calculatedPrice,
          };
        }
      });

    const productsWithTotalAndCouriers = {
      filledProducts,
      total,
      couriers: filledCouriers,
      totalQuantity: filledProducts.reduce((acc, product) => acc + (product?.quantity ?? 0), 0),
    };

    return Response.json({ status: 200, productsWithTotalAndCouriers });
  } catch (error) {
    console.log(error);
    return Response.json({ status: 500, message: "Internal server error" });
  }
}
