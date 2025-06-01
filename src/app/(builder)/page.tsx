import { fetchTopCollections } from "../api/services/collections";
import { fetchProducts } from "../api/services/products";
import { BuilderPage } from "./components/BuilderPage";

export const revalidate = 60;

const HomePage = async () => {
    const products = await fetchProducts();
    const collections = await fetchTopCollections();
    const mappedProducts = products.map((product) => ({
        ...product,
        category: "Category 1",
        description: product.collections?.[0]?.title,
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
