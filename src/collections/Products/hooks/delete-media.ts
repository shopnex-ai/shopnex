import type { Media, Product } from "@/payload-types";
import type { AfterDeleteHook } from "node_modules/payload/dist/collections/config/types";

import { isExpandedDoc } from "@/utils/is-expended-doc";

export const deleteMedia: AfterDeleteHook<Product> = async ({ doc, req }) => {
    const { payload } = req;
    req.payload.logger.debug(`Starting to delete media for product: ${doc.id}`);

    const mediaMap = new Map<string, Media>();

    for (const variant of doc.variants) {
        if (!variant.gallery) {
            req.payload.logger.debug(`Skipping variant - no gallery found`);
            continue;
        }

        req.payload.logger.debug(`Processing gallery deletion for variant`);

        for (const image of variant.gallery) {
            if (isExpandedDoc<Media>(image)) {
                if (!mediaMap.has(image.filename)) {
                    mediaMap.set(image.filename, image);
                } else {
                    req.payload.logger.debug(
                        `Duplicate filename detected, skipping: ${image.filename}`
                    );
                }
            } else {
                req.payload.logger.debug(`Skipping image - not expanded`);
            }
        }
    }

    const uniqueImages = Array.from(mediaMap.values());

    req.payload.logger.debug(
        `Deleting ${uniqueImages.length} unique media files`
    );

    const deletionResults = await Promise.allSettled(
        uniqueImages.map((image) =>
            payload
                .delete({
                    id: image.id,
                    collection: "media",
                    req,
                })
                .then(() => {
                    payload.logger.debug(
                        `Successfully deleted: ${image.filename}`
                    );
                })
                .catch((error) => {
                    payload.logger.error(
                        `Failed to delete: ${image.filename}`,
                        error
                    );
                })
        )
    );

    req.payload.logger.debug(
        `Deletion results: ${JSON.stringify(deletionResults)}`
    );
};
