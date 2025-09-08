"use client";

import {
    Button,
    FieldLabel,
    TextareaInput,
    useField,
    useListDrawer,
    ReactSelect,
} from "@payloadcms/ui";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import "./Tiptap.scss";
import { ChevronDown, CodeIcon, ImageIcon, LinkIcon } from "lucide-react";
import { TextField } from "payload";
import { useState, useRef, useEffect } from "react";
import pretty from "pretty";

const Tiptap = ({ field }: any) => {
    const { value, setValue } = useField<TextField>({ path: field.name });
    const [isHtmlPreview, setIsHtmlPreview] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [colorMode, setColorMode] = useState<"text" | "background">("text");
    const colorPickerRef = useRef<HTMLDivElement>(null);

    const [
        ListDrawer,
        ,
        { openDrawer: openMediaDrawer, closeDrawer: closeMediaDrawer },
    ] = useListDrawer({
        collectionSlugs: ["media"],
        uploads: true,
    });
    const editor = useEditor({
        extensions: [
            StarterKit,
            TextStyle,
            Color,
            Highlight.configure({
                multicolor: true,
            }),
            Image.configure({
                HTMLAttributes: {
                    class: "tiptap-image",
                },
            }),
        ],
        content: value,
        immediatelyRender: false,
        onUpdate: ({ editor }) => {
            setValue(editor.getHTML());
        },
    });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                colorPickerRef.current &&
                !colorPickerRef.current.contains(event.target as Node)
            ) {
                setShowColorPicker(false);
            }
        };

        if (showColorPicker) {
            document.addEventListener("mousedown", handleClickOutside);
            return () =>
                document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [showColorPicker]);

    const headingOptions = [
        { label: "Paragraph", value: "paragraph" },
        { label: "Heading 1", value: "h1" },
        { label: "Heading 2", value: "h2" },
        { label: "Heading 3", value: "h3" },
        { label: "Heading 4", value: "h4" },
        { label: "Heading 5", value: "h5" },
        { label: "Heading 6", value: "h6" },
        { label: "Blockquote", value: "blockquote" },
    ];

    const colorOptions = [
        "#FF3333",
        "#FF8033",
        "#FFFF33",
        "#33FF33",
        "#33AAFF",
        "#3333FF",
        "#FF33FF",
        "#000000",
        "#404040",
        "#808080",
        "#BFBFBF",
        "#E0E0E0",
        "#F7F7F7",
        "#FFFFFF",
    ];

    if (!editor) return null;

    const getCurrentHeadingValue = () => {
        if (editor.isActive("heading", { level: 1 })) return "h1";
        if (editor.isActive("heading", { level: 2 })) return "h2";
        if (editor.isActive("heading", { level: 3 })) return "h3";
        if (editor.isActive("heading", { level: 4 })) return "h4";
        if (editor.isActive("heading", { level: 5 })) return "h5";
        if (editor.isActive("heading", { level: 6 })) return "h6";
        if (editor.isActive("blockquote")) return "blockquote";
        return "paragraph";
    };

    const handleHeadingChange = (option: any) => {
        const value = option.value;

        if (value === "paragraph") {
            editor.chain().focus().setParagraph().run();
        } else if (value === "blockquote") {
            editor.chain().focus().toggleBlockquote().run();
        } else {
            const level = parseInt(value.replace("h", "")) as
                | 1
                | 2
                | 3
                | 4
                | 5
                | 6;
            editor.chain().focus().toggleHeading({ level }).run();
        }
    };

    const currentValue = headingOptions.find(
        (option) => option.value === getCurrentHeadingValue()
    );

    const handleColorSelect = (color: string) => {
        if (colorMode === "text") {
            editor.chain().focus().setColor(color).run();
        } else {
            editor.chain().focus().setHighlight({ color }).run();
        }
        setShowColorPicker(false);
    };

    const ColorPicker = () => (
        <div className="color-picker-modal" ref={colorPickerRef}>
            <div className="color-picker-tabs">
                <button
                    type="button"
                    className={colorMode === "text" ? "active" : ""}
                    onClick={() => setColorMode("text")}
                >
                    Text
                </button>
                <button
                    type="button"
                    className={colorMode === "background" ? "active" : ""}
                    onClick={() => setColorMode("background")}
                >
                    Background
                </button>
            </div>
            <div className="color-grid">
                {colorOptions.map((color) => (
                    <button
                        key={color}
                        type="button"
                        className="color-swatch"
                        style={{ backgroundColor: color }}
                        onClick={() => handleColorSelect(color)}
                        title={color}
                    />
                ))}
            </div>
            <div className="color-input-section">
                <input
                    type="color"
                    onChange={(e) => handleColorSelect(e.target.value)}
                    className="color-input"
                />
                <span>#000000</span>
            </div>
        </div>
    );

    const setLink = () => {
        const url = window.prompt("Enter URL");
        const text = window.prompt("Enter link text") || url;
        if (url && text) {
            editor
                .chain()
                .focus()
                .insertContent(`<a href="${url}" target="_blank">${text}</a>`)
                .run();
        }
    };

    const addImage = () => {
        openMediaDrawer();
    };

    return (
        <div className="tiptap-container">
            <FieldLabel label={field.label} />
            <div className="tiptap-editor">
                {/* Toolbar */}
                <div className="tiptap-toolbar">
                    <div className="tiptap-toolbar-buttons">
                        <div className="tiptap-heading-dropdown">
                            <ReactSelect
                                value={currentValue}
                                onChange={handleHeadingChange}
                                options={headingOptions}
                                isSearchable={false}
                                isClearable={false}
                                disabled={isHtmlPreview}
                                className="tiptap-select"
                            />
                        </div>
                        <Button
                            buttonStyle="icon-label"
                            disabled={isHtmlPreview}
                            onClick={() =>
                                editor.chain().focus().toggleBold().run()
                            }
                            className={
                                editor.isActive("bold") ? "is-active" : ""
                            }
                        >
                            <b>B</b>
                        </Button>
                        <Button
                            buttonStyle="icon-label"
                            disabled={isHtmlPreview}
                            onClick={() =>
                                editor.chain().focus().toggleItalic().run()
                            }
                            className={
                                editor.isActive("italic") ? "is-active" : ""
                            }
                        >
                            <i>I</i>
                        </Button>
                        <Button
                            buttonStyle="icon-label"
                            disabled={isHtmlPreview}
                            onClick={() =>
                                editor.chain().focus().toggleUnderline().run()
                            }
                            className={
                                editor.isActive("underline") ? "is-active" : ""
                            }
                        >
                            <u>U</u>
                        </Button>
                        <div className="color-picker-container">
                            <Button
                                buttonStyle="icon-label"
                                disabled={isHtmlPreview}
                                onClick={() =>
                                    setShowColorPicker(!showColorPicker)
                                }
                            >
                                <u>A</u>
                                <ChevronDown size={16} />
                            </Button>
                            {showColorPicker && !isHtmlPreview && (
                                <ColorPicker />
                            )}
                        </div>
                        <Button
                            buttonStyle="icon-label"
                            disabled={isHtmlPreview}
                            onClick={() =>
                                editor.chain().focus().toggleBulletList().run()
                            }
                            className={
                                editor.isActive("bulletList") ? "is-active" : ""
                            }
                        >
                            • List
                        </Button>
                        <Button
                            buttonStyle="icon-label"
                            disabled={isHtmlPreview}
                            onClick={() =>
                                editor.chain().focus().toggleOrderedList().run()
                            }
                            className={
                                editor.isActive("orderedList")
                                    ? "is-active"
                                    : ""
                            }
                        >
                            1. List
                        </Button>
                        <Button
                            buttonStyle="icon-label"
                            disabled={isHtmlPreview}
                            onClick={setLink}
                        >
                            <LinkIcon size={16} />
                        </Button>
                        <Button
                            buttonStyle="icon-label"
                            disabled={isHtmlPreview}
                            onClick={addImage}
                        >
                            <ImageIcon size={16} />
                        </Button>
                    </div>

                    <Button
                        buttonStyle="icon-label"
                        onClick={() => setIsHtmlPreview((prev) => !prev)}
                        className={editor.isActive("code") ? "is-active" : ""}
                    >
                        <CodeIcon size={16} />
                    </Button>
                </div>

                {/* Editor */}
                {isHtmlPreview ? (
                    <TextareaInput
                        className="textarea-input"
                        path={field.name}
                        onChange={setValue}
                        value={pretty(value as unknown as string, {
                            ocd: true,
                        })}
                    />
                ) : (
                    <EditorContent editor={editor} />
                )}
            </div>
            <ListDrawer
                onSelect={(selection) => {
                    if (selection?.doc) {
                        const selectedMedia = selection.doc as any;
                        const imageUrl =
                            selectedMedia.url || selectedMedia.filename;
                        const altText =
                            selectedMedia.alt ||
                            selectedMedia.filename ||
                            "Image";

                        if (imageUrl && editor) {
                            editor
                                .chain()
                                .focus()
                                .setImage({
                                    src: imageUrl,
                                    alt: altText,
                                })
                                .run();

                            // Close the drawer after selecting an image
                            closeMediaDrawer();
                        }
                    }
                }}
            />
        </div>
    );
};

export default Tiptap;
