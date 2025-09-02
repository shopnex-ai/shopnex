import { DefaultRootProps, RootConfig } from "@measured/puck";

export type RootProps = {
    handle: string;
    title: string;
    description: string;
};

export const Root: RootConfig<{
    props: RootProps;
    fields: {
        userField: { type: "userField"; option: boolean };
        handle: { type: "text"; label: string };
        title: { type: "text"; label: string };
        description: { type: "text"; label: string };
    };
}> = {
    fields: {
        handle: { type: "text" },
        title: { type: "text" },
        description: { type: "textarea" },
    },
    defaultProps: {
        handle: "hello-world",
        title: "Meta title",
        description: "Meta description",
    },
    render: ({ children }) => {
        return <div style={{ height: "100%" }}>{children}</div>;
    },
};

export default Root;
