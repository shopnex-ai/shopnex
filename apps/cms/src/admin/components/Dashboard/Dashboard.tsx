import type { Order } from "@/payload-types";

import config from "@payload-config";
import { Gutter } from "@payloadcms/ui";
import {
    type AdminViewServerProps,
    type BasePayload,
    getPayload,
} from "payload";
import React from "react";

import { Card, CardBody, CardFooter, CardHeader } from "./Card";
import SalesChart from "./SalesChart";

const baseClass = "dashboard";

// Helper: Format currency
const formatCurrency = (amount: number, currency = "USD") =>
    new Intl.NumberFormat("en-US", {
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
        style: "currency",
    }).format(amount);

// Helper: Calculate percentage change
const calculatePercentageChange = (
    current: number,
    previous: number
): string => {
    if (previous === 0) {
        return current > 0 ? "+100%" : "None";
    }
    const change = ((current - previous) / previous) * 100;
    return `${change.toFixed(2)}%`;
};

// Helper: Fetch orders within a date range
const fetchOrders = async (
    payload: BasePayload,
    startDate: Date,
    endDate: Date
) => {
    const result = await payload.find({
        collection: "orders",
        pagination: false,
        sort: "createdAt",
        where: {
            createdAt: {
                greater_than: startDate.toISOString(),
                less_than: endDate.toISOString(),
            },
        },
    });
    return result.docs;
};

const Dashboard = async (props: AdminViewServerProps) => {
    const payload = await getPayload({ config });

    const now = new Date();
    const getMonthRange = (monthOffset: number) => {
        const start = new Date(
            now.getFullYear(),
            now.getMonth() + monthOffset,
            1
        );
        const end = new Date(
            now.getFullYear(),
            now.getMonth() + monthOffset + 1,
            0,
            23,
            59,
            59,
            999
        );
        return { end, start };
    };

    const { end: currentEnd, start: currentStart } = getMonthRange(0);
    const { end: lastEnd, start: lastStart } = getMonthRange(-1);

    // Fetch current & last month orders
    const [currentOrders, lastOrders] = await Promise.all([
        fetchOrders(payload, currentStart, currentEnd),
        fetchOrders(payload, lastStart, lastEnd),
    ]);

    // Compute metrics
    const computeMetrics = (orders: any[]) => {
        const totalOrders = orders.length;
        const totalAmount = orders.reduce(
            (acc, order) => acc + order.totalAmount,
            0
        );
        const avgOrderValue = totalOrders > 0 ? totalAmount / totalOrders : 0;
        const totalProfit = totalAmount * 0.05; // Assume 5% profit margin
        const lifetimeValue = avgOrderValue * 10; // Assume avg. customer orders 10 times

        return {
            avgOrderValue,
            lifetimeValue,
            totalAmount,
            totalOrders,
            totalProfit,
        };
    };

    const currentMetrics = computeMetrics(currentOrders);
    const lastMetrics = computeMetrics(lastOrders);

    // Generate chart data from real order history
    const salesData = currentOrders.map((order: Order) => ({
        date: new Date(order.createdAt).toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
        }),
        orders: 1,
        profit: +(order.totalAmount * 0.05).toFixed(2),
        revenue: order.totalAmount,
    }));

    return (
        <Gutter>
            <h1 className={`${baseClass}__label`}>ShopNex</h1>
            <ul
                className={`${baseClass}__card-list`}
                style={{
                    display: "grid",
                    gap: "1rem",
                    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                    marginTop: "2rem",
                }}
            >
                <li>
                    <Card>
                        <CardHeader>Total Profit</CardHeader>
                        <CardBody>
                            {formatCurrency(currentMetrics.totalProfit)}
                        </CardBody>
                        <CardFooter>
                            {calculatePercentageChange(
                                currentMetrics.totalProfit,
                                lastMetrics.totalProfit
                            )}
                        </CardFooter>
                    </Card>
                </li>
                <li>
                    <Card>
                        <CardHeader>Avg. Order Value</CardHeader>
                        <CardBody>
                            {formatCurrency(currentMetrics.avgOrderValue)}
                        </CardBody>
                        <CardFooter>
                            {calculatePercentageChange(
                                currentMetrics.avgOrderValue,
                                lastMetrics.avgOrderValue
                            )}
                        </CardFooter>
                    </Card>
                </li>
                <li>
                    <Card>
                        <CardHeader>Total Orders</CardHeader>
                        <CardBody>
                            {currentMetrics.totalOrders.toString()}
                        </CardBody>
                        <CardFooter>
                            {calculatePercentageChange(
                                currentMetrics.totalOrders,
                                lastMetrics.totalOrders
                            )}
                        </CardFooter>
                    </Card>
                </li>
                <li>
                    <Card>
                        <CardHeader>Lifetime Value</CardHeader>
                        <CardBody>
                            {formatCurrency(currentMetrics.lifetimeValue)}
                        </CardBody>
                        <CardFooter>
                            {calculatePercentageChange(
                                currentMetrics.lifetimeValue,
                                lastMetrics.lifetimeValue
                            )}
                        </CardFooter>
                    </Card>
                </li>
            </ul>
            <SalesChart data={salesData} />
        </Gutter>
    );
};

export default Dashboard;
