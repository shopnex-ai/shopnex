"use client";
import React, { useEffect } from "react";

import { useHeaderTheme } from "@/providers/HeaderTheme";

const PageClient = () => {
  /* Force the header to be dark mode while we have an image behind it */
  const { setHeaderTheme } = useHeaderTheme();

  useEffect(() => {
    setHeaderTheme("dark");
  }, [setHeaderTheme]);
  return <></>;
};

export default PageClient;
