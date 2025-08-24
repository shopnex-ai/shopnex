import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getPayload } from "payload";

import { ProductDetails } from "@/globals/(ecommerce)/Layout/ProductDetails/Component";
import { type Locale } from "@/i18n/config";
import config from "@payload-config";

const ProductPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => {
  try {
    const payload = await getPayload({ config });
    const locale = (await getLocale()) as Locale;
    const { slug } = await params;
    const { docs } = await payload.find({
      collection: "products",
      depth: 2,
      locale,
      where: {
        slug: {
          equals: slug,
        },
      },
    });
    const { variant } = await searchParams;

    if (docs.length === 0) {
      notFound();
    }

    return <ProductDetails variant={variant} product={docs[0]} />;
  } catch {
    notFound();
  }
};

export default ProductPage;
