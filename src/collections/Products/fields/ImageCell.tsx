import config from "@/payload.config";
import Image from "next/image";
import { type DefaultServerCellComponentProps, getPayload } from "payload";
import React from "react";

const CustomImageCell = async (props: DefaultServerCellComponentProps) => {
    const payload = await getPayload({ config });

    const { cellData } = props;
    const media = await payload.findByID({
        id: cellData[0],
        collection: "media",
    });

    return (
        <Image
            alt={media.alt}
            height={50}
            src={media.url!}
            style={{ height: "50px", width: "auto" }}
            width={50}
        />
    );
};

export default CustomImageCell;
