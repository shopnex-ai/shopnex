"use client";

import { cn } from "@/app/(frontend)/_util";
import { ChevronUpDown } from "@medusajs/icons";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import * as React from "react";

function Select({
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
    return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
    return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
    return (
        <SelectPrimitive.Value
            className={cn("truncate", className)}
            {...props}
        />
    );
}
function SelectTrigger({
    children,
    className,
    size = "default",
    ...props
}: {
    size?: "default" | "sm";
} & React.ComponentProps<typeof SelectPrimitive.Trigger>) {
    return (
        <SelectPrimitive.Trigger
            className={cn(
                "relative flex items-center w-full border border-ui-border-base rounded-md bg-ui-bg-subtle hover:bg-ui-bg-field-hover transition-colors duration-150 text-base-regular px-4 py-2.5 outline-none appearance-none",
                "data-[placeholder]:text-ui-fg-muted", // Placeholder gray
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", // Match focus
                "disabled:cursor-not-allowed disabled:opacity-50",
                className
            )}
            data-size={size}
            data-slot="select-trigger"
            {...props}
        >
            <span className="flex-1 truncate text-left">{children}</span>
            <SelectPrimitive.Icon asChild>
                <ChevronUpDown className="absolute right-4 size-4 pointer-events-none text-ui-fg-muted" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
}

function SelectContent({
    children,
    className,
    position = "popper",
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                className={cn(
                    "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
                    position === "popper" &&
                        "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                    className
                )}
                data-slot="select-content"
                position={position}
                {...props}
            >
                <SelectScrollUpButton />
                <SelectPrimitive.Viewport
                    className={cn(
                        "p-1",
                        position === "popper" &&
                            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
                    )}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectScrollDownButton />
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    );
}

function SelectLabel({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
    return (
        <SelectPrimitive.Label
            className={cn(
                "text-muted-foreground px-2 py-1.5 text-xs",
                className
            )}
            data-slot="select-label"
            {...props}
        />
    );
}

function SelectItem({
    children,
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
    return (
        <SelectPrimitive.Item
            className={cn(
                "text-base-regular px-4 py-2.5 cursor-pointer hover:bg-ui-bg-field-hover focus:bg-ui-bg-field-hover rounded-md transition-colors duration-150",
                "relative flex items-center gap-2 w-full select-none data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
                className
            )}
            {...props}
        >
            <span className="absolute right-4 flex size-3.5 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <CheckIcon className="size-4" />
                </SelectPrimitive.ItemIndicator>
            </span>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
}

function SelectSeparator({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
    return (
        <SelectPrimitive.Separator
            className={cn(
                "bg-border pointer-events-none -mx-1 my-1 h-px",
                className
            )}
            data-slot="select-separator"
            {...props}
        />
    );
}

function SelectScrollUpButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
    return (
        <SelectPrimitive.ScrollUpButton
            className={cn(
                "flex cursor-default items-center justify-center py-1",
                className
            )}
            data-slot="select-scroll-up-button"
            {...props}
        >
            <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpButton>
    );
}

function SelectScrollDownButton({
    className,
    ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
    return (
        <SelectPrimitive.ScrollDownButton
            className={cn(
                "flex cursor-default items-center justify-center py-1",
                className
            )}
            data-slot="select-scroll-down-button"
            {...props}
        >
            <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownButton>
    );
}

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
};
