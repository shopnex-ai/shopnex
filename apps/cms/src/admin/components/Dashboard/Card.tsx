"use client";

import type React from "react";

import "./index.scss";

export type Props = {
    amount: string;
    children?: React.ReactNode;
    percentage: string;
    title: string;
};

const baseClass = "card";

export const Card = ({ children }: { children: React.ReactNode }) => {
    return <div className={`${baseClass}`}>{children}</div>;
};

export const CardHeader = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className={`${baseClass}__title`}>
            <span>{children}</span>
        </div>
    );
};

export const CardBody = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className={`${baseClass}__amount`}>
            <span>{children}</span>
        </div>
    );
};

export const CardFooter = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className={`${baseClass}__change`}>
            <span className={`${baseClass}__change--positive`}>{children}</span>{" "}
            From last month
        </div>
    );
};
