"use client";

import type React from "react";

import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

export type SalesData = {
    date: string;
    orders: number;
    profit: number;
    revenue: number;
};

type Props = {
    data: SalesData[];
    strokeWidth?: number;
};

const getRecentDates = (): string[] => {
    const today = new Date();
    const dates: string[] = [];

    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(
            d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" })
        );
    }

    return dates;
};

const mergeDataWithPlaceholders = (realData: SalesData[]): SalesData[] => {
    const dataMap = new Map(realData.map((item) => [item.date, item]));
    return getRecentDates().map((date) => {
        return dataMap.get(date) || { date, orders: 0, profit: 0, revenue: 0 };
    });
};

const SalesChart: React.FC<Props> = ({ data, strokeWidth = 2 }) => {
    const chartData = mergeDataWithPlaceholders(data);

    return (
        <div
            className="sales-chart bg-white rounded-lg shadow-md p-6 relative"
            style={{ marginTop: "2rem" }}
        >
            <h3 className="text-xl font-semibold mb-4 text-gray-800">
                Sales Overview
            </h3>
            <ResponsiveContainer height={400} width="100%">
                <LineChart
                    data={chartData}
                    margin={{ bottom: 10, left: -40, right: -10, top: 20 }}
                >
                    <CartesianGrid
                        stroke="#e0e0e0"
                        strokeDasharray="3 3"
                        vertical={false}
                    />
                    <XAxis
                        angle={-25}
                        axisLine={{ stroke: "#d1d5db" }}
                        dataKey="date"
                        height={60}
                        interval="preserveStartEnd"
                        textAnchor="end"
                        tick={{ fill: "#6b7280", fontSize: 12 }}
                        tickLine={{ stroke: "#d1d5db" }}
                    />
                    <YAxis
                        axisLine={{ stroke: "#d1d5db" }}
                        tick={{ fill: "#6b7280", fontSize: 12 }}
                        tickLine={{ stroke: "#d1d5db" }}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: "#f9fafb",
                            border: "1px solid #e5e7eb",
                            borderRadius: "4px",
                            padding: "8px",
                        }}
                        cursor={{ stroke: "#374151", strokeWidth: 2 }}
                        itemStyle={{ color: "#374151" }}
                    />
                    <Legend
                        iconType="circle"
                        wrapperStyle={{ fontSize: "14px", padding: "10px" }}
                    />
                    <Line
                        dataKey="revenue"
                        dot={false}
                        name="Revenue"
                        stroke="var(--color-blue-500)"
                        strokeWidth={strokeWidth}
                        type="monotone"
                    />
                    <Line
                        dataKey="orders"
                        dot={false}
                        name="Orders"
                        stroke="#5fe385"
                        strokeWidth={strokeWidth}
                        type="monotone"
                    />
                    <Line
                        dataKey="profit"
                        dot={false}
                        name="Profit"
                        stroke="#f59e0b"
                        strokeWidth={strokeWidth}
                        type="monotone"
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default SalesChart;
