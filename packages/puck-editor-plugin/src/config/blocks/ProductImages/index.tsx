import { ComponentConfig } from "@measured/puck";
import "./styles.scss";

interface ProductImagesProps {
    images?: Array<{
        large: string;
        small: string;
        alt: string;
    }>;
    productName?: string;
}

const ProductImagesComponent = ({
    images = [
        {
            large: "https://chekromul.github.io/uikit-ecommerce-template/images/products/1/1-large.jpg",
            small: "/images/products/1/1-small.jpg",
            alt: "Product Image 1",
        },
        {
            large: "https://chekromul.github.io/uikit-ecommerce-template/images/products/1/1-add-1-large.jpg",
            small: "/images/products/1/1-add-1-small.jpg",
            alt: "Product Image 2",
        },
        {
            large: "https://chekromul.github.io/uikit-ecommerce-template/images/products/1/1-add-2-large.jpg",
            small: "/images/products/1/1-add-2-small.jpg",
            alt: "Product Image 3",
        },
        {
            large: "/images/products/1/1-add-3-large.jpg",
            small: "/images/products/1/1-add-3-small.jpg",
            alt: "Product Image 4",
        },
        {
            large: "/images/products/1/1-add-4-large.jpg",
            small: "/images/products/1/1-add-4-small.jpg",
            alt: "Product Image 5",
        },
    ],
    productName = "Product Name",
}: ProductImagesProps) => {
    return (
        <div className="product-images">
            <div className="product-images__slideshow">
                <div className="product-images__main-carousel">
                    <ul className="product-images__main-list">
                        {images.map((image, index) => (
                            <li
                                key={index}
                                className={
                                    index === 0
                                        ? "product-images__main-item product-images__main-item--active"
                                        : "product-images__main-item"
                                }
                            >
                                <a
                                    className="product-images__main-link"
                                    href={image.large}
                                >
                                    <figure className="product-images__main-figure">
                                        <img
                                            src={image.large}
                                            alt={
                                                image.alt ||
                                                `${productName} - Image ${index + 1}`
                                            }
                                        />
                                    </figure>
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="product-images__thumbnails">
                    <div className="product-images__thumb-container">
                        <ul className="product-images__thumb-list">
                            {images.map((image, index) => (
                                <li
                                    key={index}
                                    className={
                                        index === 0
                                            ? "product-images__thumb-item product-images__thumb-item--active"
                                            : "product-images__thumb-item"
                                    }
                                >
                                    <div className="product-images__thumb-ratio">
                                        <a
                                            className="product-images__thumb-link"
                                            href="#"
                                            data-slide={index}
                                        >
                                            <figure className="product-images__thumb-figure">
                                                <img
                                                    src={image.small}
                                                    alt={
                                                        image.alt ||
                                                        `${productName} - Thumbnail ${index + 1}`
                                                    }
                                                />
                                            </figure>
                                        </a>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <div className="product-images__nav">
                            <button
                                className="product-images__nav-prev"
                                disabled
                            >
                                <svg width="14" height="24" viewBox="0 0 14 24">
                                    <polyline
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.4"
                                        points="12.775,1 1.225,12 12.775,23"
                                    />
                                </svg>
                            </button>
                            <button className="product-images__nav-next">
                                <svg width="14" height="24" viewBox="0 0 14 24">
                                    <polyline
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.4"
                                        points="1.225,23 12.775,12 1.225,1"
                                    />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <ul className="product-images__dots">
                        {images.map((_, index) => (
                            <li
                                key={index}
                                className={
                                    index === 0
                                        ? "product-images__dot product-images__dot--active"
                                        : "product-images__dot"
                                }
                            >
                                <button data-slide={index}></button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
};

export const ProductImages: ComponentConfig<ProductImagesProps> = {
    render: ProductImagesComponent,
    label: "Product Images",
    fields: {
        images: {
            type: "array",
            arrayFields: {
                large: { type: "text" },
                small: { type: "text" },
                alt: { type: "text" },
            },
        },
        productName: {
            type: "text",
        },
    },
    defaultProps: {
        images: [
            {
                large: "https://chekromul.github.io/uikit-ecommerce-template/images/products/1/1-large.jpg",
                small: "/images/products/1/1-small.jpg",
                alt: "Product Image 1",
            },
            {
                large: "https://chekromul.github.io/uikit-ecommerce-template/images/products/1/1-add-1-large.jpg",
                small: "/images/products/1/1-add-1-small.jpg",
                alt: "Product Image 2",
            },
            {
                large: "https://chekromul.github.io/uikit-ecommerce-template/images/products/1/1-add-2-large.jpg",
                small: "/images/products/1/1-add-2-small.jpg",
                alt: "Product Image 3",
            },
            {
                large: "/images/products/1/1-add-3-large.jpg",
                small: "/images/products/1/1-add-3-small.jpg",
                alt: "Product Image 4",
            },
            {
                large: "/images/products/1/1-add-4-large.jpg",
                small: "/images/products/1/1-add-4-small.jpg",
                alt: "Product Image 5",
            },
        ],
        productName: "Product Name",
    },
};
