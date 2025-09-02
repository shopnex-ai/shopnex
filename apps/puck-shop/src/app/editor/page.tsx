"use client";

import dynamic from "next/dynamic";

const EditorClient = dynamic(() => import("./editor-client"), {
    ssr: false,
    loading: () => (
        <div className="flex items-center justify-center h-screen">
            <div className="text-lg">Loading editor...</div>
        </div>
    ),
});

export default function EditorPage() {
    return <EditorClient />;
}
