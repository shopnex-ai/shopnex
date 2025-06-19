import type { RowLabelProps } from "@payloadcms/ui";
import type { ArrayFieldServerProps } from "payload";

const OptionRowLabel = (
    props: { rowLabel: string } & ArrayFieldServerProps & RowLabelProps
) => {
    if (!props.siblingData.options?.length) {
        return <p>{props.rowLabel}</p>;
    }
    const optionValue = props.siblingData.options
        .map((option: any) => option.value)
        .filter((option: any) => option);

    if (optionValue.length === 0) {
        return <p>{props.rowLabel}</p>;
    }
    return <p>{optionValue.join(" / ")}</p>;
};

export default OptionRowLabel;
