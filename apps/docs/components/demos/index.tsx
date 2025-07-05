// import { Sandpack } from '@codesandbox/sandpack-react'
// import { monokaiPro } from "@codesandbox/sandpack-themes";

// import { configFiles } from "./files/index";

const Demo: React.FC<
    React.PropsWithChildren<{
        demoId: string;
        dependencies?: Record<string, string>;
    }>
> = () => {
    return (
        <div style={{ margin: "10px 0 0" }}>
            {/* <Sandpack
        template="react"
        files={configFiles(demoId)}
        theme={monokaiPro}
        customSetup={{
          dependencies: {
            '@reactour/tour': '*',
            ...dependencies,
          },
        }}
      /> */}
        </div>
    );
};

export default Demo;

export function doSteps(demoId: string, length: number) {
    return Array.from({ length }, (_, i) => ({
        content: stepsContent[i],
        selector: `[data-tour="step-${i + 1}-${demoId}"]`,
    }));
}

const stepsContent = [
    <p key={0}>Vamos a la playa!</p>,
    <p key={1}>Play beach ball all day long!</p>,
    <p key={2}>Then, a deliciuos ice cream!</p>,
    <p key={3}>What about going to fish?</p>,
    <p key={4}>Let`&apos;s stay traveling!</p>,
];
