import { UserConfig } from "../types/user-config";
import { Button } from "./blocks/Button";
import { Card } from "./blocks/Card";
import { Grid } from "./blocks/Grid";
import { Heading } from "./blocks/Heading";
import { Flex } from "./blocks/Flex";
import { Logos } from "./blocks/Logos";
import { Stats } from "./blocks/Stats";
import { Text } from "./blocks/Text";
import { Space } from "./blocks/Space";
import { TopHeader } from "./blocks/TopHeader";
import { NavBar } from "./blocks/NavBar";
import { NavBar2 } from "./blocks/NavBar2";
import { NavBar3 } from "./blocks/NavBar3";
import { Hero1 } from "./blocks/Hero1";
import { Hero2 } from "./blocks/Hero2";
import { Hero3 } from "./blocks/Hero3";
import { Hero4 } from "./blocks/Hero4";
import { Hero5 } from "./blocks/Hero5";
import { Footer } from "./blocks/Footer";
import { Footer2 } from "./blocks/Footer2";
import { ProductsGrid1 } from "./blocks/ProductsGrid1";
import { Breadcrumb } from "./blocks/Breadcrumb";
import { ProductDetails } from "./blocks/ProductDetails";
import { Image } from "./blocks/Image";
import { CategoriesGrid1 } from "./blocks/CategoriesGrid1";
import { Carousel1 } from "./blocks/Carousel1";
import { Subscribe } from "./blocks/Subscribe";
import { TrendingItems } from "./blocks/TrendingItems";
import { ProductImages } from "./blocks/ProductImages";
import { ProductInfo } from "./blocks/ProductInfo";
import { ContactInformation } from "./blocks/ContactInformation";
import { Shipping } from "./blocks/Shipping";
import Root from "./root";

export const clientConfig: UserConfig = {
    root: Root,
    categories: {
        navigation: {
            title: "Navigation",
            components: [
                "TopHeader",
                "NavBar",
                "NavBar2",
                "NavBar3",
                "Footer",
                "Footer2",
                "Breadcrumb",
            ],
        },
        heroes: {
            title: "Heroes",
            components: ["Hero1", "Hero2", "Hero3", "Hero4", "Hero5"],
        },
        ecommerce: {
            title: "E-commerce",
            components: [
                "ProductsGrid1",
                "ProductDetails",
                "ProductImages",
                "ProductInfo",
                "ContactInformation",
                "Shipping",
                "CategoriesGrid1",
                "TrendingItems",
            ],
        },
        layout: {
            components: ["Grid", "Flex", "Space"],
        },
        typography: {
            components: ["Heading", "Text"],
        },
        interactive: {
            title: "Actions",
            components: ["Button"],
        },
        media: {
            title: "Media",
            components: ["Image", "Carousel1"],
        },
        other: {
            title: "Other",
            components: ["Card", "Logos", "Stats", "Subscribe"],
        },
    },
    components: {
        TopHeader,
        NavBar,
        NavBar2,
        NavBar3,
        Footer,
        Footer2,
        Breadcrumb,
        Hero1,
        Hero2,
        Hero3,
        Hero4,
        Hero5,
        ProductsGrid1,
        ProductDetails,
        ProductImages,
        ProductInfo,
        ContactInformation,
        Shipping,
        Button,
        Card,
        Grid,
        Heading,
        Flex,
        Logos,
        Stats,
        Text,
        Space,
        Image,
        Carousel1,
        CategoriesGrid1,
        Subscribe,
        TrendingItems,
    },
};
