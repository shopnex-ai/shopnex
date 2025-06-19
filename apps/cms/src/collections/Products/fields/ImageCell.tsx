import config from "@/payload.config";
import Image from "next/image";
import { type DefaultServerCellComponentProps, getPayload } from "payload";
import React from "react";

const ImageCell = async (props: DefaultServerCellComponentProps) => {
    const payload = await getPayload({ config });

    const { rowData } = props;
    const mediaId = rowData?.variants?.[0]?.gallery?.[0];
    let imageUrl = rowData?.variants?.[0]?.imageUrl || rowData?.picture;
    if (mediaId) {
        const media = await payload.findByID({
            id: mediaId,
            collection: "media",
        });
        imageUrl = media.url || imageUrl;
    }

    if (!imageUrl) {
        return null;
    }

    return (
        <Image
            alt={"Image"}
            height={50}
            src={imageUrl}
            style={{ height: "50px", width: "auto" }}
            width={50}
        />
    );
};

export default ImageCell;
