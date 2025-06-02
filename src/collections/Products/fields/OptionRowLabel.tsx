const OptionRowLabel = (props) => {
    if (!props.siblingData.options) {
        return null;
    }
    const optionValue = props.siblingData.options.map(
        (option: any) => option.value
    );
    return <p>{optionValue.join(" / ")}</p>;
};

export default OptionRowLabel;
