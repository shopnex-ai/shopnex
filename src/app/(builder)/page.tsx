import { getTopCollections } from "../api/services/collections";
import { getProducts } from "../api/services/products";
import { BuilderPage } from "./lib/BuilderPage";

const HomePage = async () => {
    const products = await getProducts();
    const collections = await getTopCollections();
    const mappedProducts = products.map((product) => ({
        ...product,
        category: "Category 1",
        description: (product.collections?.[0] as any)?.title,
        image: product.variants[0].imageUrl,
        originalPrice: product.variants[0].originalPrice,
        pageUrl: `/products/${product.handle}`,
        price: product.variants[0].price,
    }));

    return (
        <BuilderPage
            data={{
                collections,
                products: mappedProducts,
            }}
            page={[""]}
        />
    );
};

export default HomePage;
