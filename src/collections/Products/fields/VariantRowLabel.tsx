import Image from "next/image";

const VariantRowLabel = (props) => {
    if (!props.data.variants) {
        return null;
    }
    const currentRow = props.data.variants.find(
        (v, index: number) => index === props.rowNumber - 1
    );
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
