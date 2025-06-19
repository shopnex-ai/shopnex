import config from "@payload-config";
import { importSymbolsInit } from "@shopnex/builder-io-plugin";
import { getPayload } from "payload";

export const pagesSeed = async () => {
    await importSymbolsInit(process.env.BUILDER_IO_PRIVATE_KEY!);
    const payload = await getPayload({ config });
    const pages = [
        {
            handle: "",
            title: "Home",
        },
        {
            handle: "products",
            title: "Product Details",
        },
        {
            handle: "cart",
            title: "Cart",
        },
        {
            handle: "checkout",
            title: "Checkout",
        },
        {
            handle: "contact-us",
            title: "Contact Us",
        },
    ];
    for (const page of pages) {
        await payload.create({
            collection: "pages",
            data: page,
        });
    }
};

console.log("Seeding pages...");
await pagesSeed();
console.log("Seeding pages complete!");
process.exit(0);
