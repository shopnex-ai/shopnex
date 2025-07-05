import { Logo } from "@components/logo/Logo";
import { getPageMap } from "nextra/page-map";

import "./globals.css";

import { Footer, Layout, Navbar } from "nextra-theme-docs";

export const metadata = {
    description: "ShopNex",
    title: {
        default: "ShopNex",
        template: "%s | ShopNex",
    },
};

const navbar = (
    <Navbar
        logo={<Logo />}
        projectLink="https://github.com/shopnex-ai/shopnex"
    />
);
const footer = <Footer></Footer>;

export default async function RootLayout({ children }) {
    return (
        <html dir="ltr" lang="en" suppressHydrationWarning>
            <body>
                <Layout
                    docsRepositoryBase="https://github.com/shopnex-ai/shopnex/tree/main/apps/docs"
                    editLink={<>Edit this page on GitHub </>}
                    feedback={{
                        content: "Question? Give us feedback →",
                        labels: "feedback",
                    }}
                    footer={footer}
                    navbar={navbar}
                    pageMap={await getPageMap()}
                    search={false}
                    sidebar={{
                        defaultMenuCollapseLevel: 1,
                        toggleButton: true,
                    }}
                    toc={{ backToTop: true }}
                >
                    {children}
                </Layout>
            </body>
        </html>
    );
}
