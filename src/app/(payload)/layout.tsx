import type { ServerFunctionClient } from "payload";

import "@payloadcms/next/css";

import type React from "react";

/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import config from "@payload-config";
import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts";

import { importMap } from "./admin/importMap.js";

type Args = {
    children: React.ReactNode;
};

// biome-ignore lint/complexity/useArrowFunction: <explanation>
const serverFunction: ServerFunctionClient = async function (args) {
    "use server";
    return handleServerFunctions({
        ...args,
        config,
        importMap,
    });
};

const Layout = ({ children }: Args) => (
    <RootLayout
        config={config}
        importMap={importMap}
        serverFunction={serverFunction}
    >
        {children}
    </RootLayout>
);

export default Layout;
