export const isSimpleProduct = (product: any): boolean => {
    return (
        product.options?.length === 1 && product.options[0].values?.length === 1
    );
};
