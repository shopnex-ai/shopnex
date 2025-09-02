"use client";

import { Puck, Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { config } from "@/lib/puck-config";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "puck-home-data";

export default function EditorClient() {
  const router = useRouter();
  const [data, setData] = useState<Data>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error("Failed to parse saved data:", e);
        }
      }
    }
    return {
      content: [],
      root: {},
    };
  });

  const handlePublish = (newData: Data) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
    setData(newData);
    alert("Page published successfully! View it at the home page.");
  };

  const handleChange = (newData: Data) => {
    setData(newData);
  };

  return (
    <div className="h-screen">
      <Puck
        config={config}
        data={data}
        onPublish={handlePublish}
        onChange={handleChange}
        overrides={{
          header: ({ actions, children }) => (
            <header className="flex items-center justify-between p-4 border-b bg-background">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => router.push("/")}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  ← Back to site
                </button>
                <h1 className="text-lg font-semibold">Page Editor</h1>
              </div>
              <div className="flex items-center gap-2">
                {children}
                {actions}
              </div>
            </header>
          ),
        }}
      />
    </div>
  );
}