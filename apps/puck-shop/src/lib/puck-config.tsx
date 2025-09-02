import { Config } from "@measured/puck";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Components = {
  HeadingBlock: {
    children: string;
    level: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  };
  TextBlock: {
    content: string;
    align?: "left" | "center" | "right";
  };
  ButtonBlock: {
    label: string;
    href: string;
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
    size?: "default" | "sm" | "lg" | "icon";
  };
  CardBlock: {
    title: string;
    description: string;
    content: string;
  };
  HeroBlock: {
    title: string;
    subtitle: string;
    buttonText: string;
    buttonLink: string;
    backgroundImage?: string;
  };
  GridBlock: {
    columns: number;
    gap: number;
  };
  SpacerBlock: {
    height: number;
  };
};

export const config: Config<Components> = {
  categories: {
    typography: {
      title: "Typography",
      components: ["HeadingBlock", "TextBlock"],
    },
    layout: {
      title: "Layout",
      components: ["GridBlock", "SpacerBlock"],
    },
    content: {
      title: "Content",
      components: ["CardBlock", "HeroBlock"],
    },
    actions: {
      title: "Actions",
      components: ["ButtonBlock"],
    },
  },
  components: {
    HeadingBlock: {
      label: "Heading",
      fields: {
        children: {
          type: "text",
          label: "Text",
        },
        level: {
          type: "select",
          label: "Level",
          options: [
            { label: "H1", value: "h1" },
            { label: "H2", value: "h2" },
            { label: "H3", value: "h3" },
            { label: "H4", value: "h4" },
            { label: "H5", value: "h5" },
            { label: "H6", value: "h6" },
          ],
        },
      },
      defaultProps: {
        children: "Heading",
        level: "h2",
      },
      render: ({ children, level }) => {
        const Tag = level;
        const className = {
          h1: "text-4xl font-bold",
          h2: "text-3xl font-semibold",
          h3: "text-2xl font-semibold",
          h4: "text-xl font-medium",
          h5: "text-lg font-medium",
          h6: "text-base font-medium",
        }[level];
        
        return <Tag className={className}>{children}</Tag>;
      },
    },
    TextBlock: {
      label: "Text",
      fields: {
        content: {
          type: "textarea",
          label: "Content",
        },
        align: {
          type: "radio",
          label: "Alignment",
          options: [
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
            { label: "Right", value: "right" },
          ],
        },
      },
      defaultProps: {
        content: "Enter your text here",
        align: "left",
      },
      render: ({ content, align }) => {
        return <p className={`text-${align}`}>{content}</p>;
      },
    },
    ButtonBlock: {
      label: "Button",
      fields: {
        label: {
          type: "text",
          label: "Label",
        },
        href: {
          type: "text",
          label: "Link",
        },
        variant: {
          type: "select",
          label: "Variant",
          options: [
            { label: "Default", value: "default" },
            { label: "Destructive", value: "destructive" },
            { label: "Outline", value: "outline" },
            { label: "Secondary", value: "secondary" },
            { label: "Ghost", value: "ghost" },
            { label: "Link", value: "link" },
          ],
        },
        size: {
          type: "select",
          label: "Size",
          options: [
            { label: "Default", value: "default" },
            { label: "Small", value: "sm" },
            { label: "Large", value: "lg" },
            { label: "Icon", value: "icon" },
          ],
        },
      },
      defaultProps: {
        label: "Click me",
        href: "#",
        variant: "default",
        size: "default",
      },
      render: ({ label, href, variant, size }) => {
        return (
          <Button variant={variant} size={size} asChild>
            <a href={href}>{label}</a>
          </Button>
        );
      },
    },
    CardBlock: {
      label: "Card",
      fields: {
        title: {
          type: "text",
          label: "Title",
        },
        description: {
          type: "text",
          label: "Description",
        },
        content: {
          type: "textarea",
          label: "Content",
        },
      },
      defaultProps: {
        title: "Card Title",
        description: "Card description",
        content: "Card content goes here",
      },
      render: ({ title, description, content }) => {
        return (
          <Card>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p>{content}</p>
            </CardContent>
          </Card>
        );
      },
    },
    HeroBlock: {
      label: "Hero Section",
      fields: {
        title: {
          type: "text",
          label: "Title",
        },
        subtitle: {
          type: "textarea",
          label: "Subtitle",
        },
        buttonText: {
          type: "text",
          label: "Button Text",
        },
        buttonLink: {
          type: "text",
          label: "Button Link",
        },
        backgroundImage: {
          type: "text",
          label: "Background Image URL",
        },
      },
      defaultProps: {
        title: "Welcome to Our Store",
        subtitle: "Discover amazing products at great prices",
        buttonText: "Shop Now",
        buttonLink: "/products",
      },
      render: ({ title, subtitle, buttonText, buttonLink, backgroundImage }) => {
        return (
          <section 
            className="relative py-24 px-4 text-center"
            style={backgroundImage ? {
              backgroundImage: `url(${backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            } : {
              background: 'linear-gradient(to right, #667eea, #764ba2)',
            }}
          >
            <div className="relative z-10 max-w-4xl mx-auto">
              <h1 className="text-5xl font-bold text-white mb-4">{title}</h1>
              <p className="text-xl text-white/90 mb-8">{subtitle}</p>
              <Button size="lg" asChild>
                <a href={buttonLink}>{buttonText}</a>
              </Button>
            </div>
            {backgroundImage && (
              <div className="absolute inset-0 bg-black/40 z-0" />
            )}
          </section>
        );
      },
    },
    GridBlock: {
      label: "Grid Layout",
      fields: {
        columns: {
          type: "number",
          label: "Columns",
          min: 1,
          max: 12,
        },
        gap: {
          type: "number",
          label: "Gap (px)",
          min: 0,
          max: 100,
        },
      },
      defaultProps: {
        columns: 3,
        gap: 16,
      },
      render: ({ columns, gap, puck }) => {
        return (
          <div 
            className="w-full"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: `${gap}px`,
            }}
          >
            {puck.renderDropZone('grid-zone')}
          </div>
        );
      },
    },
    SpacerBlock: {
      label: "Spacer",
      fields: {
        height: {
          type: "number",
          label: "Height (px)",
          min: 0,
          max: 500,
        },
      },
      defaultProps: {
        height: 48,
      },
      render: ({ height }) => {
        return <div style={{ height: `${height}px` }} />;
      },
    },
  },
  root: {
    render: ({ children }) => {
      return <div className="min-h-screen bg-background">{children}</div>;
    },
  },
};