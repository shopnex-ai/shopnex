import type { RowLabelProps } from "@payloadcms/ui";
import type { ArrayFieldServerProps } from "payload";

import Image from "next/image";

const VariantRowLabel = (
    props: { rowLabel: string } & ArrayFieldServerProps & RowLabelProps
) => {
    if (!props.data.variants) {
        return <p>{props.rowLabel}</p>;
    }
    const currentRow = props.data.variants.find(
        (_: any, index: number) => index === (props.rowNumber as number) - 1
    );
    if (!currentRow.options?.length) {
        return <p>{props.rowLabel}</p>;
    }
    const variantValues = currentRow.options.map((option: any) => option.value);
    const imageUrl = currentRow.gallery?.[0]?.url || currentRow.imageUrl;
    return (
        <div style={{ display: "flex", gap: "1rem" }}>
            <Image
                alt={currentRow.name}
                height={0}
                sizes="100vw" // Optional hint for responsive images
                src={imageUrl}
                style={{ height: "25px", width: "auto" }}
                width={0} // Required for layout="intrinsic"
            />
            <p>{variantValues.join(" / ") + ` - $${currentRow.price}`}</p>
        </div>
    );
};

export default VariantRowLabel;
