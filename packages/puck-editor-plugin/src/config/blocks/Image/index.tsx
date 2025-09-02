import React from "react";
import { ComponentConfig } from "@measured/puck";

export type ImageProps = {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  className?: string;
};

export const Image: ComponentConfig<ImageProps> = {
  fields: {
    src: {
      type: "text",
      label: "Image Source",
    },
    alt: {
      type: "text",
      label: "Alt Text",
    },
    width: {
      type: "number",
      label: "Width",
    },
    height: {
      type: "number",
      label: "Height",
    },
    className: {
      type: "text",
      label: "CSS Classes",
    },
  },
  defaultProps: {
    src: "https://via.placeholder.com/150",
    alt: "Image",
    width: 150,
    height: 150,
    className: "",
  },
  render: ({ src, alt, width, height, className }) => (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
    />
  ),
};