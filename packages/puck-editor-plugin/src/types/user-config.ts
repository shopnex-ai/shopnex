import { Config, Data } from "@measured/puck";
import { ButtonProps } from "../config/blocks/Button";
import { CardProps } from "../config/blocks/Card";
import { FlexProps } from "../config/blocks/Flex";
import { GridProps } from "../config/blocks/Grid";
import { HeadingProps } from "../config/blocks/Heading";
import { LogosProps } from "../config/blocks/Logos";
import { SpaceProps } from "../config/blocks/Space";
import { StatsProps } from "../config/blocks/Stats";
import { TextProps } from "../config/blocks/Text";
import { TopHeaderProps } from "../config/blocks/TopHeader";
import { NavBarProps } from "../config/blocks/NavBar";
import { NavBar2Props } from "../config/blocks/NavBar2";
import { Hero1Props } from "../config/blocks/Hero1";
import { Hero2Props } from "../config/blocks/Hero2";
import { Hero3Props } from "../config/blocks/Hero3";
import { Hero4Props } from "../config/blocks/Hero4";
import { Hero5Props } from "../config/blocks/Hero5";
import { FooterProps } from "../config/blocks/Footer";
import { ProductsGrid1Props } from "../config/blocks/ProductsGrid1";
import { BreadcrumbProps } from "../config/blocks/Breadcrumb";
import { ProductDetailsProps } from "../config/blocks/ProductDetails";
import { ImageProps } from "../config/blocks/Image";
import { RootProps } from "../config/root";

export type Components = {
    TopHeader: TopHeaderProps;
    NavBar: NavBarProps;
    NavBar2: NavBar2Props;
    Footer: FooterProps;
    Breadcrumb: BreadcrumbProps;
    Hero1: Hero1Props;
    Hero2: Hero2Props;
    Hero3: Hero3Props;
    Hero4: Hero4Props;
    Hero5: Hero5Props;
    ProductsGrid1: ProductsGrid1Props;
    ProductDetails: ProductDetailsProps;
    Button: ButtonProps;
    Card: CardProps;
    Grid: GridProps;
    Heading: HeadingProps;
    Flex: FlexProps;
    Logos: LogosProps;
    Stats: StatsProps;
    Text: TextProps;
    Space: SpaceProps;
    Image: ImageProps;
};

export type UserConfig = Config<{
    components: Components;
    root: RootProps;
    categories: ["navigation", "heroes", "ecommerce", "layout", "typography", "interactive", "media"];
    fields: {
        userField: {
            type: "userField";
            option: boolean;
        };
        title: {
            type: "text";
            label: string;
        };
        description: {
            type: "text";
            label: string;
        };
    };
}>;

export type UserData = Data<Components, RootProps>;
