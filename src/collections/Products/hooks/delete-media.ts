import type { Media, Product } from "@/payload-types";
import type { AfterDeleteHook } from "node_modules/payload/dist/collections/config/types";
import type { BasePayload } from "payload";

import { isExpandedDoc } from "@/utils/is-expended-doc";

export const deleteMedia: AfterDeleteHook<Product> = async ({ doc, req }) => {
    const { payload } = req;

    req.payload.logger.debug(`Starting to delete media for product: ${doc.id}`);

    for (const variant of doc.variants) {
        if (!variant.gallery) {
            req.payload.logger.debug(`Skipping variant - no gallery found`);
            continue;
        }

        req.payload.logger.debug(`Processing gallery deletion for variant`);

        await deleteGalleryImages(variant.gallery, payload);
    }
};

async function deleteGalleryImages(
    gallery: (Media | number)[],
    payload: BasePayload
) {
    payload.logger.debug(`Deleting gallery images, count: ${gallery.length}`);

    for (const image of gallery) {
        if (!isExpandedDoc<Media>(image)) {
            payload.logger.debug(`Skipping image - no access to filename`);
            continue;
        }
        payload.logger.debug(`Deleting media with filename: ${image.filename}`);
        await payload.delete({
            collection: "media",
            where: {
                filename: {
                    equals: image.filename,
                },
            },
        });
    }
}
