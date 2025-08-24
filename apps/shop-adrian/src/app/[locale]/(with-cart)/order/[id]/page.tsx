import { getTranslations } from "next-intl/server";
import { getPayload } from "payload";

import { Media as MediaComponent } from "@/components/Media";
import RichText from "@/components/RichText";
import { type Locale } from "@/i18n/config";
import { Link } from "@/i18n/routing";
import { type Media } from "@/payload-types";
import config from "@/payload.config";
import { formatPrice } from "@/utilities/formatPrices";
import { getCachedGlobal } from "@/utilities/getGlobals";
import { getOrderProducts } from "@/utilities/getOrderProducts";

const OrdersPage = async ({ params }: { params: Promise<{ locale: Locale; id: string }> }) => {
  const { locale, id } = await params;
  const payload = await getPayload({ config });
  const order = await payload.findByID({
    collection: "orders",
    id,
    locale,
  });

  const t = await getTranslations("Order");
  const c = await getTranslations("CheckoutForm.countries");

  const filledProducts = await getOrderProducts(order.products, locale);

  const courier =
    order.orderDetails.shipping && (await getCachedGlobal(order.orderDetails.shipping, locale, 1)());

  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="max-w-xl">
          <h1 className="text-base font-medium text-indigo-600">{t("thank-you")}</h1>
          <p className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
            {t(`${order.orderDetails.status}.title`)}
          </p>
          <p className="mt-2 text-base text-gray-500">
            {t(`${order.orderDetails.status}.subtitle`, { orderID: order.id })}
          </p>

          {order.orderDetails.trackingNumber && (
            <dl className="mt-12 text-sm font-medium">
              <dt className="text-gray-900">{t("tracking-number")}</dt>
              <dd className="mt-2 text-indigo-600">{order.orderDetails.trackingNumber}</dd>
            </dl>
          )}
        </div>

        <div className="mt-10 border-t border-gray-200">
          <h2 className="sr-only">{t("your-order")}</h2>

          <h3 className="sr-only">{t("items")}</h3>
          {filledProducts?.map((product) => {
            const selectedVariant = product.variants?.find(
              (variant) => variant.variantSlug === product.variantSlug,
            );

            console.log(selectedVariant);
            const productImage =
              product.variants && product.variantSlug
                ? ((product.variants.find((variant) => product.variantSlug === variant.variantSlug)?.image ??
                    product.images[0]) as Media | undefined)
                : (product.images[0] as Media);

            return (
              <div
                key={`${product.id}-${product.variantSlug}`}
                className="flex space-x-6 border-b border-gray-200 py-6"
              >
                <MediaComponent
                  resource={productImage}
                  className="size-20 flex-none rounded-lg bg-gray-100 object-cover sm:size-28"
                />
                <div className="flex flex-auto flex-col">
                  <div>
                    <h4 className="font-medium text-gray-900">
                      <Link
                        href={`/product/${product.slug}${product.variants && selectedVariant && `?variant=${selectedVariant.variantSlug}`}`}
                      >
                        {product.title}
                      </Link>
                    </h4>
                    <p className="mt-2 text-sm text-gray-500">
                      {product.colors?.find((color) => color.slug === selectedVariant?.color)?.label}
                      {selectedVariant?.color && selectedVariant?.size && ", "}
                      {product.sizes?.find((size) => size.slug === selectedVariant?.size)?.label}
                    </p>
                    {product.description && (
                      <RichText data={product.description} className="mt-2 text-sm text-gray-600" />
                    )}
                  </div>
                  <div className="mt-6 flex flex-1 items-end">
                    <dl className="flex space-x-4 divide-x divide-gray-200 text-sm sm:space-x-6">
                      <div className="flex">
                        <dt className="font-medium text-gray-900">{t("quantity")}</dt>
                        <dd className="ml-2 text-gray-700">{product.quantity}</dd>
                      </div>
                      <div className="flex pl-4 sm:pl-6">
                        <dt className="font-medium text-gray-900">{t("price")}</dt>
                        <dd className="ml-2 text-gray-700">
                          {formatPrice(product.priceTotal, order.orderDetails.currency, locale)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="sm:ml-40 sm:pl-6">
            <h3 className="sr-only">{t("your-information")}</h3>

            <h4 className="sr-only">{t("shipping")}</h4>
            <dl className="grid grid-cols-2 gap-x-6 border-gray-200 py-10 text-sm">
              <div>
                <dt className="font-medium text-gray-900">{t("shipping-address")}</dt>
                <dd className="mt-2 text-gray-700">
                  <address className="not-italic">
                    <span className="block">{order.shippingAddress.name}</span>
                    <span className="block">
                      {order.shippingAddress.postalCode}, {order.shippingAddress.city}
                    </span>
                    <span className="block">
                      {order.shippingAddress.region}, {c(order.shippingAddress.country)}
                    </span>
                    {order.shippingAddress.pickupPointID && (
                      <>
                        <span className="block">
                          {t("pickup-point")}: {order.shippingAddress.pickupPointID}
                        </span>
                        {order.shippingAddress.pickupPointAddress && (
                          <span>{order.shippingAddress.pickupPointAddress}</span>
                        )}
                      </>
                    )}
                  </address>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">{t("shipping-method")}</dt>
                <dd className="mt-2 text-gray-700">
                  <p>{courier?.settings.label}</p>
                  <p>{courier?.settings.description}</p>
                </dd>
              </div>
            </dl>

            <h3 className="sr-only">{t("summary")}</h3>

            <dl className="space-y-6 border-t border-gray-200 pt-10 text-sm">
              <div className="flex justify-between">
                <dt className="font-medium text-gray-900">{t("subtotal")}</dt>
                <dd className="text-gray-700">
                  {formatPrice(order.orderDetails.total, order.orderDetails.currency, locale)}
                </dd>
              </div>
              {/* <div className="flex justify-between">
                <dt className="flex font-medium text-gray-900">
                  Discount
                  <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                    STUDENT50
                  </span>
                </dt>
                <dd className="text-gray-700">-$18.00 (50%)</dd>
              </div> */}
              <div className="flex justify-between">
                <dt className="font-medium text-gray-900">{t("shipping")}</dt>
                <dd className="text-gray-700">
                  {formatPrice(order.orderDetails.shippingCost, order.orderDetails.currency, locale)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-gray-900">{t("total")}</dt>
                <dd className="text-gray-900">
                  {formatPrice(order.orderDetails.totalWithShipping, order.orderDetails.currency, locale)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};
export default OrdersPage;
